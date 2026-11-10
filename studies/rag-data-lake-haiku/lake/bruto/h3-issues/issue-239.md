# Issue #239: `res._implicitHeader` is not a function with `express-session`

Estado: CLOSED. Criada em 2022-11-18, fechada em 2022-11-19. Autor: nopeless.

```ts
// Middleware definition
fromNodeMiddleware(
    session({
      secret,
      resave: false,
      saveUninitialized: true,
    }) as any
  )

// Used in nuxt eventually
export default defineEventHandler(middleware);
```

I belive this is a minor error from either `session`'s part or `h3` not supporting compatibility

If the issue isn't seem obvious enough, let me know so I can give a more detailed report and a reproduction

## Comentário de nozomuikuta em 2022-11-18

@nopeless 

> error from either session's part or h3 not supporting compatibility

> I can give a more detailed report and a reproduction

TBH, it's the best way to provide a reproduction from the beginning, for other people to find where is the root cause and consequently help you in some way.

## Comentário de nopeless em 2022-11-18

Sometimes the issue is very obvious; I guess this isn't the case

## Comentário de nopeless em 2022-11-19

https://stackblitz.com/edit/nuxt-starter-ybzyms?file=app.vue,pages%2Findex.vue,server%2Fmiddleware%2Fsession.ts

Here is a reproduction

Once the server is running, copy the link and paste it in your browser

## Comentário de pi0 em 2022-11-19

`express-session` requires `express` app polyfills to work. Something like this partially works:

```ts
import express from 'express';
import session from 'express-session';

export default fromNodeMiddleware(express().use(session({
  secret: '123',
  resave: false,
  saveUninitialized: true,
}) as any))
```

I would suggest you to use iron-session or another package that is not depending on express. Iron session example: https://stackblitz.com/edit/github-z5kpi7?file=app.vue (try locally)

(note: stackblitz does not supports setting cookies. try both locally)

## Comentário de pi0 em 2022-11-19

There is also https://github.com/wobsoriano/h3-session but i haven't tried it nor endorse.

## Comentário de nopeless em 2022-11-19

Ah so h3 is not fully compatible with express (or express session is using a non-api)

Anyway, thanks for clarifying
