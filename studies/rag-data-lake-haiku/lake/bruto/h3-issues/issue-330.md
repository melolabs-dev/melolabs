# Issue #330: readMultipartFormData - Invalid code point NaN on Netlify

Estado: CLOSED. Criada em 2023-02-14, fechada em 2023-08-01. Autor: robertorinaldi-dev.

### Environment

Netlify with runtime node versions 16 or 18

### Reproduction

The error shows only on Netlify log, I don't know how to create a reproduction

### Describe the bug

Using readMultipartFormData is working fine on local, but on netlify gives error

### Additional context

_No response_

### Logs

```sh
ERROR  [nuxt] [request error] [unhandled] [500] Invalid code point NaN
  at Function.fromCodePoint (<anonymous>)  
  at parse (./node_modules/h3/dist/index.mjs:31:26)  
  at readMultipartFormData (./node_modules/h3/dist/index.mjs:316:10)  
  at async ./chunks/index.post.mjs:51:31  
  at async Object.handler (./node_modules/h3/dist/index.mjs:990:19)  
  at async toNodeHandle (./node_modules/h3/dist/index.mjs:1065:7)  
  at async lambda (./chunks/nitro/netlify.mjs:3771:13)
```

## Comentário de robertorinaldi-dev em 2023-02-15

Going deeper...

On local readRawBody(event, false) returns something like <Buffer 2d 2d 2d 2d 2d 2d 57 65 62 4b 69 74 46 6f 72 6d 42 6f 75 6e 64 61 72 79 4c 55 69 4c 79 6d 4e 38 41 6b 58 64 76 42 79 33 0d 0a 43 6f 6e 74 65 6e 74 2d ...

On netlify instead it returns LS0tLS0tV2ViS2l0Rm9ybUJvdW5kYXJ5U1MzTEtCRXRNMlhoaEtVVA0KQ29udGVudC1EaXNwb3NpdGlvbjogZm9ybS1kYXRhOyBuYW1lPSJmb3JtLW5hbWUiDQoNCndvc ...

Could it be an encoding issue?

## Comentário de robertorinaldi-dev em 2023-02-15

It's related to https://github.com/unjs/nitro/issues/912.

In my specific case I fixed it by replacing
`if ("body" in event.node.req) {
    return Promise.resolve(event.node.req.body);
  }`
in readRawBody, with
`if ('body' in event.node.req) {
    return Promise.resolve(Buffer.from(event.node.req.body, 'base64'))
}`

## Comentário de ashutosh887 em 2023-03-01

@robertorinaldi-dev Does this need some work?

## Comentário de robertorinaldi-dev em 2023-03-01

Hi,
I don't know, in my case I solved it like that, am I the only one who had this problem with readMultipartFormData and Netlify?

## Comentário de mileo em 2023-04-05

> Hi,
> 
> I don't know, in my case I solved it like that, am I the only one who had this problem with readMultipartFormData and Netlify?

I'm having the same issue here.

## Comentário de AloisSeckar em 2023-04-28

I think I just ran into same thing.

I am using `body = await readMultipartFormData(event)` inside Nuxt 3 `defineEventHandler` and while it works as expected running on localhost, after deploying to Netlify, `body.at(0)` is falsy...

Running on `Nuxt 3.4.2 with Nitro 2.3.3` so the fix reported in linked https://github.com/unjs/nitro/issues/912 doesn`t seem to fix it for me :( 

[Here is my repo](https://github.com/AloisSeckar/antique-wolf) and [here](https://github.com/AloisSeckar/antique-wolf/blob/main/server/api/imageUpload.post.ts) the failing class, if someone can suggest a solution (like more native way to parse the incomming multipart form?) I call the Nitro server route from [here](https://github.com/AloisSeckar/antique-wolf/blob/main/pages/admin/items.vue) (row 46) - maybe something can be improved here?
