# Issue #851: readMultipartFormData error when parsing big files

Estado: OPEN. Criada em 2024-07-26. Autor: GuppyTheCat.

### Environment

node.js: 22.4.1
nuxt: 3.12.4
primevue: 3.53.0
vue: 3.4.34

### Reproduction

Here is repo - [file-upload-test](https://github.com/GuppyTheCat/file-upload-test)
On button click you choose file and upload should automatically start.

### Describe the bug

I have nuxt3 application.
I send file from nuxt3 frontend to nuxt3 server api.
If i send file approximately larger than 100Mb then i get error while parsing multipart from data.

### Additional context

_No response_

### Logs
```
Error reading multipart form data: Invalid array length

  at Array.push (<anonymous>)
  at parse (node_modules/.pnpm/h3@1.12.0/node_modules/h3/dist/index.mjs:196:16)
  at readMultipartFormData (node_modules/.pnpm/h3@1.12.0/node_modules/h3/dist/index.mjs:469:10)
  at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
  at Object.handler (server/api/upload.post.ts:4:1)
  at async node_modules/.pnpm/h3@1.12.0/node_modules/h3/dist/index.mjs:1975:19
  at async Object.callAsync (node_modules/.pnpm/unctx@2.3.1/node_modules/unctx/dist/index.mjs:72:16)
  at async Server.toNodeHandle (node_modules/.pnpm/h3@1.12.0/node_modules/h3/dist/index.mjs:2266:7)```

## Comentário de s3xybun em 2024-11-13

Hi Guppy, it looks like it will be fixed in v2. #514

## Comentário de moshetanzer em 2025-03-17

Any current workaround @s3xysteak

## Comentário de s3xybun em 2025-03-17

> Any current workaround [@s3xysteak](https://github.com/s3xysteak)

Maybe you can ask @pi0 . I had no idea so I had to start another Express service dedicated to file uploads, sharing the data by sharing a table that holds the path to the file. 😭

## Comentário de moshetanzer em 2025-03-17

Ahh. No! There definitely are ways to do with other kind I ended up using `busboy` and can also be done with `formidable`, was more asking a way to do this without another lib or some sort of simple patch!

## Comentário de productdevbook em 2025-07-07

@pi0 I want to work on this for v2. Can we do it only for v2?

## Comentário de paranoidPhantom em 2025-08-21

I can confirm this is an issue I am also experiencing
