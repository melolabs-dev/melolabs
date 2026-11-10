# Issue #986: Streams are poorly handled on Node.js

Estado: CLOSED. Criada em 2025-03-04, fechada em 2026-03-16. Autor: Hornwitser.

### Environment

Node.js v22.14.0
h3 v1.15.1

### Reproduction

Repository: https://github.com/Hornwitser/h3-stream-problems

See the README.md file for instructions on reproduction steps.

### Describe the bug

When handling streams it's important that backpressure and errors are properly handled as failure to do so can lead to resource leaks, crashes, and denial of service vulnerabilities that are trivially exploitable in your app.

## Bad error handling in streamed responses

h3 promises a really simple interface for working with response streams, just return the stream and it'll work:

```js
import { createReadStream } from "node:fs";
router.get(
    "/stream",
    defineEventHandler(event => {
        return createReadStream("path/to/file");
    })
);
```

At first glance this appears to be just fine. But if the client aborts the request mid-way the premature close of the network stream is not handled by h3 and the file stream is kept open, which in turn means the file descriptor opened by the file stream is leaked.

Errors should also be handled when originating from opposite direction as well, streams don't always succeed at providing the data promised. If the hard drive returns an uncorrectable read error of the file being streamed, Node.js's file stream will raise an error event and destroy the file stream, but h3 does not handle this error and terminate the network stream. As a result the request will simply hang indefinitely in the middle of the stream.

The `node:stream` pipeline function correctly handles both of these cases, so if it is used instead like this:

```js
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream";
router.get(
    "/stream",
    defineEventHandler(event => {
        const stream = createReadStream("path/to/file");
        pipeline(stream, event.node.res, (err) => { if (err) console.error(err) });
        event._handled = true;
    })
);
```

Then a client aborting a request will close the file stream and release the file handle, and an error from the file stream will terminate the network stream.

h3 fails to propagate errors in both directions for both Node.js stream and the web standard `ReadableStream` interface.

## No backpressure in Response streams

Another important aspect when handling stream is making sure that backpressure gets propagated from the consumer to the producer. When responding with a Node.js stream this works as it should, but when using a web standard `ReadableStream` h3 will read from it as fast as possible and buffer data that has yet to be sent to the client in memory. For example the following fast feeding infinite stream will crash the server when running with Node.js:

```js
router.get(
    "/stream",
    defineEventHandler(event => {
        return new ReadableStream({
            pull(controller) {
                controller.enqueue(new TextEncoder().encode("Infinity!\n".repeat(1e6)));
                return new Promise(resolve => setTimeout(resolve, 10));
            }
        });
    })
);
```

Once again, using the `node:stream` pipeline function to pass the stream over does not have this issue. It'll only buffer a small amount of data and pull from the stream when it needs more to send the client.

## No backpressure in Request streams

To get a stream of the request body sent by the client h3 provides `getRequestWebStream(event)`. This returns a `ReadableStream` that you can process or pipe into a writable stream. This also does not handle backpressure, and will buffer infinite data from the client should the client be sending it faster than the stream is consumed on the server.

## Bad error handling in Request streams

When consuming readable streams it's common to close the stream when done with it. The pipeline helper does this, and `for await` iteration also does this by default. But the stream provided by `getRequestWebStream` will be closed when the request stream ends, and no error handling is done on this, which means this canonical async iteration of the read stream

```js
router.post(
    "/stream",
    defineEventHandler(event => {
        for await (const chunk of getRequestWebStream(event)) {
            throw Error("oops something went wrong");
            // Leaving the async iteration here closes the stream by default.
        }
    })
);
```

will cause Node.js to crash with this uncaught exception:

```
node:internal/webstreams/readablestream:1077
      throw new ERR_INVALID_STATE.TypeError('Controller is already closed');
      ^

TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed
```

You can avoid this by iterating through `getRequestWebStream(event).values({ preventCancel: true }}`. Though using the pipeline function directly with the `event.node.req` stream does not have either of these problems.

## Discussion

The handling of streams in h3 on Node.js is currently so bad that one is bettor off not trying to use any of the provided functionality. None of these surprising behaviours are documented, nor is any guidance provided on how to properly handle errors when dealing with streams, which leads to a bad developer experience using h3.

I ran into these issues when trying to make an EventSource stream work on Nuxt.js, and the more I dug into it the more problems I found.

### Additional context

See also somewhat related discussions at https://gist.github.com/Atinux/05836469acca9649fa2b9e865df898a2 and https://github.com/nitrojs/nitro/issues/2118


### Logs

```sh

```

## Comentário de Hornwitser em 2025-03-05

I ran the same test code against the current main branch for h3 v2, and all the tests cases except for `node client.mjs get node client-error` were still exhibiting the same bad behaviour. In addition to that the `event._handled = true` workaround to prevent h3 from touching the response no longer works. This will break real code in used the wild (see the linked gist in the previous post) and therefore should absolutely be documented in the migration guide.

Given that the v2 branch's stream handling is just as broken as v1, you now have to do esoteric workarounds to even be able to correctly handle response streams. For example, this works correctly in h3 v2:

```js
defineEventHandler(event => {
    const stream = createReadStream("path/to/file");
    pipeline(stream, event.node.res, (err) => { if (err) console.error(err) });
    return { pipe: () => new Promise((resolve, reject) => {
        // ignore pipe to trick h3 into not touching the response stream
    } )}
})
```

Correctly handling errors and backpressure in response streams should not be this hard!

## Comentário de katywings em 2025-12-14

Also noticed `(node:XYZ) Warning: Closing file descriptor XYZ on garbage collection` logs on my server since some time already 😅, also in h3 v2. I finally figured out that they come from my file streams.

Long story short: just convert your `ReadStream` to a `ReadableStream` according to the code below. ReadableStream properly cancels the stream and closes the file handle, if the browser aborts the request.

```ts
import { createReadStream, ReadStream } from "fs";

// In your handler/middleware
return ReadStream.toWeb(createReadStream("path/to/file"));
```

Actual code: https://codeberg.org/nitropage/nitropage/src/commit/00dccecef43eb273b9870efcc71c7b11fab965ff/packages/filesystem/src/drivers/local.ts#L146

---

The linked code also shows an implementation of video streaming. One thing I noticed with `serveStatic` is that it strictly sets the status code inline to 200 since a82863fc2e29bc6a0c31555071fbd74167ff4197, which breaks 206 video streams. I temporary fixed this by returning `result.body` instead of `result`:

https://codeberg.org/nitropage/nitropage/src/commit/00dccecef43eb273b9870efcc71c7b11fab965ff/packages/filesystem/src/drivers/local.ts#L171

---

@pi0 What do you think about these workarounds 😅?

## Comentário de pi0 em 2025-12-15

Very nice finding @katywings! Wondering if we should improve [srvx static](https://github.com/h3js/srvx/blob/879ab07654853968b9027941b0c9b21f84e95bca/src/static.ts#L97) implementation to convert into ReadableStream...

Feel free to submit a patch for h3 serverStatic to pick `event.res.status` if set seems also valid 👍🏼

## Comentário de productdevbook em 2026-03-14

@pi0 This is labeled v1. v2 is built entirely on web standard primitives (`ReadableStream`, `Response`, etc.) — the old Node.js stream handling via `res.end()` / pipes is gone. Stream handling is delegated to the `srvx` abstraction layer.

Can this be closed as resolved in v2?

## Comentário de pi0 em 2026-03-14

Nuxt v5 will soon migrate to Nitro v3 and H3 v2 to leverage all improvements on stream handling.

If any issues you experience in v2 / srvx or Nitro v3 please do report 🙏🏼

## Comentário de Hornwitser em 2026-03-15

While stream handling have indeed improved, not all cases of error propagation has been fixed on response streams. Here is a table comparing the behaviour of streams on v1 and v2.

|Condition|h3 v1|h3 v2|
|---|---|---|
|node response stream aborted by client|❌ not propagated, leaks stream|❌ not propagated, leaks stream|
|web response stream aborted by client|❌ not propagated, leaks stream|✔️ correctly handled|
|node response stream error by server|❌ not propagaed, response hangs|💥 crashes server|
|web response stream error by server|❌ not propagated, response hangs|❔ exception is not logged|
|node response stream backpressure|✔️ correctly handled|✔️ correctly handled|
|web response stream backpressuer|❌ server buffers whole stream|✔️ correctly handled|
|node request stream backpressure|✔️ correctly handled|✔️ correctly handled|
|web request stream backpressure|❌ server buffers whole stream|✔️ correctly handled|
|node request stream aborted by client|✔️ correctly handled|✔️ correctly handled|
|web request stream aborted by client|✔️ correctly handled|✔️ correctly handled|
|node request stream error by server|✔️ correctly handled|✔️ correctly handled|
|web request stream error by server|💥 crashes server if stream is closed|✔️ correctly handled|

I've updated the [reproduction repository](https://github.com/Hornwitser/h3-stream-problems) to use h3 v2.0.1-rc.16 to show this.
