# Issue #375: An error occurred when using the proxyRequest method to proxy a DELETE request.

Estado: CLOSED. Criada em 2023-04-12, fechada em 2025-04-15. Autor: WongSaang.

### Environment

Nuxt

### Reproduction

This is the code for the server middleware in my Nuxt project:

```
export default defineEventHandler((event) => {
    if (event.node.req.url.startsWith('/api/')) {
        return proxyRequest(
            event,
            (process.env.SERVER_DOMAIN || 'http://localhost:8000') + event.node.req.url
        )
    }
})
```

### Describe the bug

```
[nuxt] [request error] [unhandled] [500] fetch failed                                                                                         16:59:26
  at Object.fetch (node:internal/deps/undici/undici:14062:11)
  at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
  at async sendProxy (./node_modules/h3/dist/index.mjs:506:20)
  at async Object.handler (./node_modules/h3/dist/index.mjs:1247:19)
  at async Server.toNodeHandle (./node_modules/h3/dist/index.mjs:1322:7)
```

### Additional context

_No response_

### Logs

_No response_

## Comentário de lenqwang em 2023-04-14

I had the same problem

## Comentário de tjhiggins em 2023-04-20

Found a fix from https://github.com/unjs/nitro/issues/1137

`export NODE_OPTIONS='--no-experimental-fetch'`

It seems the experimental fetch doesn't like `content-length: 0` for deletes.

## Comentário de migueabellan em 2024-01-24

My workaround for this issue was to add an empty body in the DELETE method.

```
fetch(url, { method: 'DELETE', body: [] }),
```

## Comentário de pi0 em 2024-01-25

(note for myself) some nice investigation by @jasenmichael  https://github.com/unjs/h3/pull/605#issuecomment-1910787078 most intrestingly that it seems to be reproducable only with Nuxt3 (maybe because of browser request?)

## Comentário de eljass em 2024-02-23

We had this problem and the problem to proxy `OPTIONS` requests. It seems that from Node v20.11.0 onwards, this issue has been fixed within the `fetch` as upgrading node from `v18.7.1` to `v20.11.0` removes the error.

The problem here was originated from undici's fetch which resulted the error `UND_ERR_REQ_CONTENT_LENGTH_MISMATCH`. For some reason, the error the h3 server prints does not include the cause. To print that we needed to modify these lines to catch original error: https://github.com/unjs/h3/blob/c8aa150b59d12f1a25ef154c00eeae132da59a32/src/utils/proxy.ts#L84C3-L88C6

```ts
const response = await _getFetch(opts.fetch)(target, {
    headers: opts.headers,
    ignoreResponseError: true,
    // make $ofetch.raw transparent
    ...opts.fetchOptions
  }).catch((error) => {
    console.log(error.message, error)
    throw error
  });
```

```
TypeError: fetch failed
    at Object.fetch (node:internal/deps/undici/undici:11576:11)
    at async sendProxy (file:///****/node_modules/h3/dist/index.mjs:1096:20)
    at async file:///****/node_modules/h3/dist/index.mjs:1700:19
    at async Object.callAsync (file:///****/node_modules/unctx/dist/index.mjs:72:16)
    at async Server.toNodeHandle (file:///****/node_modules/h3/dist/index.mjs:1910:7) {
  cause: RequestContentLengthMismatchError: Request body length does not match content-length header
      at write (node:internal/deps/undici/undici:10059:41)
      at _resume (node:internal/deps/undici/undici:1

## Comentário de ramazansancar em 2025-02-17

Is there a permanent solution being worked on for this? @pi0 

I evaluated @migueabellan 's [suggestion](https://github.com/unjs/h3/issues/375#issuecomment-1907976548) for a quick solution.
