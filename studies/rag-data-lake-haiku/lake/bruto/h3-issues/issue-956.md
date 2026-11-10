# Issue #956: Forwarded event fetch request having double headers in Nuxt/SEO module (triggered in server middleware)

Estado: CLOSED. Criada em 2025-01-16, fechada em 2025-01-16. Autor: Xenossolitarius.

### Environment

node 20
mac m3

### Reproduction

Connected all the dots

### Describe the bug

On the receiving API 
Invalid URL

    at new URL (node:internal/url:806:29)
    at getRequestURL (/XXX/node_modules/.pnpm/h3@1.13.1/node_modules/h3/dist/index.mjs:337:10)
    at Object.handler (server/middleware/01.auth.ts:8:1)
    at /XXX/node_modules/.pnpm/h3@1.13.1/node_modules/h3/dist/index.mjs:1963:31
    at async Object.callAsync (/XXX/node_modules/.pnpm/unctx@2.4.1/node_modules/unctx/dist/index.mjs:72:16)
    at async toNodeHandle (/XXX/node_modules/.pnpm/h3@1.13.1/node_modules/h3/dist/index.mjs:2255:7)
    at async ufetch (/XXX/node_modules/.pnpm/unenv@1.10.0/node_modules/unenv/runtime/fetch/index.mjs:9:17)
    at async $fetchRaw2 (/XXX/node_modules/.pnpm/ofetch@1.4.1/node_modules/ofetch/dist/shared/ofetch.03887fc3.mjs:258:26)
    at async $fetchRaw2 (/XXX/node_modules/.pnpm/ofetch@1.4.1/node_modules/ofetch/dist/shared/ofetch.03887fc3.mjs:311:14)
    at async $fetch2 (/XXX/node_modules/.pnpm/ofetch@1.4.1/node_modules/ofetch/dist/shared/ofetch.03887fc3.mjs:316:15)



Breaks with 

![Image](https://github.com/user-attachments/assets/47920f7f-aa74-4b5a-a0bf-f1ed2072f614)

while using event as a fetchContainer

on

getRequestURL

![Image](https://github.com/user-attachments/assets/8e598e58-2ab3-45ca-8376-35822d1a4626)

where the vars are:

![Image](https://github.com/user-attachments/assets/40193698-e8bf-4f66-af5a-670e7ba0e79e)

the double "localhost:3000, localhost:3000" shouldn't be there I guess

Also this error only happens in nuxt server middleware when getRequestURL is called

https://github.com/unjs/h3/pull/946/files

I believe the change above introduced such issue

Not really sure if this is the upstream issue but tnx again for taking a look!



### Additional context






### Logs

```sh

```

## Comentário de harlan-zw em 2025-01-16

On my end it looks like it's caused by a workaround I did for the bug fixed in: https://github.com/unjs/h3/pull/946

I can remove my workaround but that will break earlier versions so probably better to merge them correctly.

## Comentário de harlan-zw em 2025-01-16

Actually I think this is a bug purely on the Sitemap module using `defu` to merge the headers now that I'm looking into the h3 source.

Will move discussion to https://github.com/nuxt-modules/sitemap/issues/400

## Comentário de Xenossolitarius em 2025-01-17

Yea, sorry couldn't debug it properly. Goes too deep into some very internal logic there

## Comentário de harlan-zw em 2025-01-17

I'm not convinced of my above point either now actually, no idea 🤷 

Will track in sitemap for now

## Comentário de Xenossolitarius em 2025-01-17

Ok, i'll try to debug it today and will report the results.

## Comentário de harlan-zw em 2025-01-17

This would likely fix it but I'm concerned it may introduce regressions https://github.com/nuxt-modules/sitemap/pull/402
