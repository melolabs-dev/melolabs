# Issue #585: Router does not match on defined nested routes

Estado: CLOSED. Criada em 2023-11-29, fechada em 2023-12-07. Autor: MarcTroll.

### Environment

h3 v. 1.9.0
Node.js v. 18.18.0

### Reproduction

https://stackblitz.com/edit/github-2bmusk-disoey?file=app.ts

### Describe the bug

I have a nested router defined to collect all api-routes. These routes are automatically assigned the prefix "/api/" for when requesting data through the webserver. In the reproduction I created a router, added a "get"-request for "/test". When navigating to "/test" the expected output is returned. I also created another router, which is added to the router for nesting "/api"-routes. When accessing "/api/", the expected output is printed but for "/api/hello" the webserver just returns a 404 stating it can not find any route matching the path.

### Additional context

_No response_

### Logs

_No response_

## Comentário de ceodevforce em 2023-12-03

@ilouHD going to need a little bit more information on this? I have a set and nested routers work fine for me

## Comentário de MarcTroll em 2023-12-04

In my case the minimalistic example provided above does not work and I have no clue why. Did I make a mistake? Or can you see any other problems?

The following routes are registered:
- /test (not nested, works)
- /api/ (nested, works)
- /api/hello (nested, does not work)

## Comentário de ceodevforce em 2023-12-05

Well from the stackblitz I cant see what is wrong, but in terms of how I write nested routes it slightly different.

## Comentário de MarcTroll em 2023-12-05

Can you tell me, what are you doing differently? Can you provide a minimal working example?

## Comentário de ceodevforce em 2023-12-05

I am trying to see if I pushed some code from my stream when I was using H3 to build some APIs I will link it later

## Comentário de pi0 em 2023-12-07

Hi. Checking your repo, there is a slight change needed. You need to use `router.use('/api/**', useBase('/api', apiRouter.handler));` (with `/**` to catch all nested paths)

I will update our example accordingly as it was missing it to and were misleading.
