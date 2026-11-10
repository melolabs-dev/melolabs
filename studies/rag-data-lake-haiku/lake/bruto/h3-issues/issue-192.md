# Issue #192: Allow to chain event handlers

Estado: CLOSED. Criada em 2022-10-14, fechada em 2023-07-27. Autor: tobiasdiez.

It would be nice if event handlers could be chained to create a new event handler that invokes each handler after each other. Something like:

```
chain(defineCorsHandler(...), eventHandler(event => ...)) // this is an event handler again
```

This is especially relevant for usage in nuxt, where one usually declares one event handler for a certain route and then in the declaration would like to specify cors options (using h3-cors) in parallel to invoking the actual handler.

Related: https://github.com/unjs/h3/issues/177

## Comentário de pi0 em 2022-10-14

Hi @tobiasdiez. As explained in the relevant issue, h3 utilities like cors, are meant to be called functions on demand and in the body of the event handler as best practices.

Middleware style chaining is also possible using an app stack, `createApp().use(corsMiddleware).use(actualHandler)` which itself is an event handler if you prefer chaining. Have you tried this pattern?

For the purpose of pre/post handlers, we might improve defineHandler BTW probably by supporting something like this:

```ts
defineHandler((event) => {}, { before: [cors], after: [validate] })
```

Wdyt?

## Comentário de tobiasdiez em 2022-10-14

Thanks for your answer!

> As explained in the relevant issue, h3 utilities like cors, are meant to be called functions on demand and in the body of the event handler as best practices.

That works, except if you want to chain two event handlers that you don't really have control (in my case the cors handler, and a apollo-h3-server handler that I'm currently developing). It is also not so convenient if the cors handler sometimes should handle the complete request (preflight) but in other cases only modify the response.

> Middleware style chaining is also possible using an app stack

Nice suggestion. Is this production ready or is the overhead of `createApp` too big? (creating an app sounds expensive, but since h3 is so lightweight...)

> `defineHandler((event) => {}, { before: [cors], after: [validate] })`

Sounds like a good idea. I guess if you need multiple handlers you just add them to the array? 
```ts
defineHandler((event) => {}, { before: [cors, auth], after: [validate] })
```

## Comentário de notshekhar em 2022-11-23

createApp is not working. ERROR: Invalid lazy handler result. It should be a function

## Comentário de notshekhar em 2022-11-23

@pi0

## Comentário de notshekhar em 2022-11-23

```js 
import { createApp } from "h3"

export default function eventHandlers(...handlers: Array<any>) {
    const app = createApp()
    app.use(handlers.map((func) => defineEventHandler(func)))
    return app
}
```

ERROR: [nuxt] [request error] [unhandled] [500] Invalid lazy handler result. It should be a function:
  at ./node_modules/h3/dist/index.mjs:618:17  
  at async Object.handler (./node_modules/h3/dist/index.mjs:681:19)  
  at async Server.toNodeHandle (./node_modules/h3/dist/index.mjs:745:7)

## Comentário de notshekhar em 2022-11-25

@pi0
