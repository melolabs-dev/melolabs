# Issue #93: How to stream files

Estado: CLOSED. Criada em 2022-04-11, fechada em 2022-04-16. Autor: maciej-jezierski.

Hi, I am trying to stream files from local disc (for a reason it's not served as static).

I tried to use sendStream or send it directly to pipe but each time I get 404. Documentation is not mentioning too much how to use streams. How to use it correctly with h3?


```
export default defineEventHandler((event) -> 
     const stream = fs.createReadStream(path);
     stream.pipe(event.res);
)
```

or 

```
const stream = fs.createReadStream(path);
      sendStream(event, stream);
```

## Comentário de zelid em 2022-04-12

I have the same issue with Nuxt 3 and asked for help at https://github.com/nuxt/framework/discussions/4299

Found this thread created 22 hours ago while going to ask the same on `h3` repo issues.

## Comentário de maciej-jezierski em 2022-04-16

I found solution by using playground and checking code. Solution is super simple, sendStream has to be returned directly 

```
const r = "/path/to/file
return sendStream(event, fs.createReadStream(r))
```

In my case if you have promise first it's working as well

```
return $fetch(apiUrl, { method: "GET", parseResponse: JSON.parse }).
    .then(r => sendStream(event, fs.createReadStream(r.path)))
```

KISS, but generally would be good to add it to documentation before some other people run into this issue as streaming files is common exercise.

## Comentário de atinux em 2022-04-16

Would love to see a PR to https://v3.nuxtjs.org/guide/features/server-routes#handling-requests-with-body to add an example about it 💚

## Comentário de maciej-jezierski em 2022-04-16

@Atinux I've even prepared code for h3 Readme.md and Nuxt repo as well with samples, but apparently I have some access problem. Will try to push it later.

## Comentário de maciej-jezierski em 2022-04-16

Nuxt PR: https://github.com/nuxt/framework/pull/4401

## Comentário de pi0 em 2022-04-17

@Atinux We should probably start adding examples directly to h3 docs. Otherwise, we will end up with fragmented documentation and outdated info for utils. Also, consider `sendStream` support is not universal yet.
