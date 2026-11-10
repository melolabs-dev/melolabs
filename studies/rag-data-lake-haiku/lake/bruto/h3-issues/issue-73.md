# Issue #73: Migrating to Events API

Estado: CLOSED. Criada em 2022-03-23, fechada em 2024-07-18. Autor: pi0.

h3 was born with the idea of being a platform-agnostic server framework for all JavaScript environments and backward compatibility with legacy server middleware format for Node.js and Express compatibility.

Initially, we started with the most backward-compatible format `(req, res)` and improved it by async support `async (req, res)` and also directly returning a response for a pleasant experience with `(req, res) => 'Hello World'` format.

[unjs/unenv](https://github.com/unjs/unenv) provides a [createCall](https://github.com/unjs/unenv/blob/a88e927dcfacc7c1e43ee434894a41c2a03f3b0c/src/runtime/fetch/call.ts#L18) and mocks of [Node.js `HTTP` built-ins](https://github.com/unjs/unenv/tree/main/src/runtime/node). Thanks to this mocking framework, h3 is able to work nicely on almost any serverless or Worker platform.

However, this kind of setup keeps h3 to be away from **natively supporting** non Node.js environments with the cost of unenv overhead for any code not using Node.js.

Additionally, `(req, res)` format is not even suitable to extend h3 supporting Node.js features like [http2](https://nodejs.org/api/http2.html) without compatibility API and `ws` support.

Migration to `(event)` format will be progressive and backward compatibility wherever necessary however we potentially have to introduce breaking changes as semver-minor until reaching `h3@1.0.0`.

### Progress

- [x] opt-in using event format using `defineEventHandler` (#74)
- [x] use Event api with utils with compatibility layer (https://github.com/unjs/h3/pull/75)
- [x] Event class (#81)
- [x] Make node-js handlers opt-in and drop `(req, res)` implicit conversion (#178)
- [x] Make `event.req` and `event.res` optional and adopt more of event native (#231)
- [ ] Mock (with warning) for req, res (#472)
- [ ] Migrate all leftover utils

## Comentário de PhaxeNor em 2022-05-19

Would this potentially add support for `waitUntil` in the `fetch` listener? So it could be utilized with Cloudflare Workers lifecycle for instance. (https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil)

## Comentário de nathanchase em 2022-12-11

So what's the roadblock to get h3 (and Nuxt 3, as a result) to serve files via [http2](https://nodejs.org/api/http2.html) protocol?

## Comentário de Hebilicious em 2023-04-27

I manually implemented something like this to play with Request/Response compatible libraries :

```ts
const getRequestFromEvent = async (event: H3Event) => {
  const url = new URL(getRequestURL(event))
  const method = getMethod(event)
  const body = method === "POST" ? await readRawBody(event) : undefined
  return new Request(url, { headers: makeHeaders(getRequestHeaders(event)), method, body })
}
```

A much cleaner and robust version of these would be greatly appreciated.

Something like this ...

```ts
const sendResponse = (event: H3Event, response: Response): Response => {
//implement, maybe this doesn't need to return a Response
}
```
... might be useful too.

For reference [hattip](https://github.com/hattipjs/hattip) seems to share similar design goals with h3, but is using a different API based on standard Request/Response.

## Comentário de pi0 em 2023-06-20

Linking amazing PR: https://github.com/unjs/h3/pull/395 for reference

## Comentário de alimozdemir em 2023-10-03

Hello,

Is there any estimated date for completing this functionality?

## Comentário de joshmossas-old em 2023-12-02

If anyone is trying to get http2 to work I was able to get up and running with [node-spdy](https://github.com/spdy-http2/node-spdy).

Here's some example code:

```ts
import { readFileSync } from 'fs';
import { createApp, eventHandler, toNodeListener } from 'h3';
import spdy from 'spdy';

const app = createApp();
app.use(
    '/',
    eventHandler(() => {
        return 'Hello world';
    }),
);

const options: spdy.ServerOptions = {
    cert: readFileSync('./<path-to-certificate>'),
    key: readFileSync('./<path-to-key>'),
};

const server = spdy.createServer(options, toNodeListener(app));

server.listen(3000, () => console.log('Server running on localhost:3000'));
```

If you need unencrypted traffic, (which is what I needed to get this running on Google Cloud Run) then you set the server options like so:

```ts
const options: spdy.ServerOptions = {
    spdy: {
        plain: true,
    },
};
```

Anyway hopefully this saves someone else the hours of trial and error I just went through :sweat_smile:
