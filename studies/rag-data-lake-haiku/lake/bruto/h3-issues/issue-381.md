# Issue #381: [nuxt] [request error] [unhandled] [500] The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received an instance of Promise

Estado: CLOSED. Criada em 2023-05-02, fechada em 2023-06-20. Autor: rafaeldsousa.

### Environment

node: v16.17
nuxt: 3.4.2
nitro: 2.3.3

### Reproduction

Nuxt API requests using useAsyncData + $fetch in frontend and server api uses `await readBody`

### Describe the bug

frontend request
```js
const body = { params: { ...route.query } }

const { data, error } = await useAsyncData(
    'server-api',
    () => $fetch('/api/server-api', { method: 'post', body: body }),
    {
        initialCache: false
    }
).catch((e) => console.error(e))
```

server API composable
```js
export default defineEventHandler(async (event) => {

    const body = await readBody(event)
}
```

### Additional context

Same issue as described here https://github.com/unjs/h3/commit/19d133d by many others. 
This latest release `1.4.0` seems to break things.

There is a workaround but it doesn't feel like something we'd actually want to be doing all over projects.
https://github.com/unjs/h3/commit/19d133d#r109674536

### Logs

```sh
[nuxt] [request error] [unhandled] [500] The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object. Received an instance of Promise
```

## Comentário de danielroe em 2023-05-02

Would you be able to provide a reproduction? 🙏

## Comentário de rafaeldsousa em 2023-05-02

@danielroe this would be sort of a clone in terms of npm packages and env setup I have, but I cannot reproduce the issue on codesandbox. (note I have some `resolutions` on `package.json` to force some version to what I have locally)
https://codesandbox.io/p/sandbox/hellow-rkt3in

Locally and on the azure server we use I can definitely still reproduce the issue when I upgrade to 1.6.4. (Video below)

https://user-images.githubusercontent.com/39249777/235794974-f6d3ccd7-4b91-4e81-9d1b-08a4cb4c3fd9.mp4

## Comentário de so1ve em 2023-05-17

Found it first introduced in https://github.com/unjs/h3/commit/19d133d6a33ffb742713f4d83f00f555aeb83224

## Comentário de igorjacauna em 2023-05-21

I used [this](https://github.com/unjs/h3/commit/19d133d6a33ffb742713f4d83f00f555aeb83224#r109674536) workaround, in commit that @so1ve mentioned, to make work my api routes. But, api routes created by libs like `nuxt-vuefire` for example, that has not the workaround implemented, throw the error.

PS: Error only shows up in production. I use Firebase to deploy.

## Comentário de so1ve em 2023-05-30

It suddenly worked in nuxt 3.5.1, and the workaround seemed to be buggy :(

## Comentário de danielroe em 2023-05-30

@so1ve so is the issue resolved now?
