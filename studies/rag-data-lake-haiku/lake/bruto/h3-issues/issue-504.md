# Issue #504: Support for trusted proxy headers

Estado: OPEN. Criada em 2023-08-10. Autor: harlan-zw.

### Describe the feature

As a module author, for maximum compatibility, it makes life easier to just use the proxy headers and fallback to node specifics. The issue is that these won't be safe in all environments and can be spoofed (i.e `x-forwarded-for`)

To solve this we need a simple implementation that:
1. allows users to provide a list of trusted proxies
2. allows module authors to generate the headers using this list of trusted proxies

I think combining 1 and 2 may be difficult but maybe you have some ideas on that. As a simple first implementation a `getRequestTrustedHeaders(event, trustedProxies)` may be enough.

Inspo: https://laravel.com/docs/master/requests#configuring-trusted-proxies


### Additional information

- [X] Would you be willing to help implement this feature?

## Comentário de pi0 em 2023-08-11

We have `getRequestHost({ xForwardedHost: true })`. Main benefit of using utils for each semi-standard header likt this is that we can support other vendor header as same name. How do you feel about introducing smaller utils like `getRequestIP` instead?

## Comentário de harlan-zw em 2023-08-11

Not sure if this explanation is answering the issue about trusting easily spoofed headers. 

H3 should provide a small util function to only get the trusted values, similar to https://github.com/symfony/http-foundation/blob/6.3/Request.php#L783

It would then be on frameworks to allow configuring the trusted proxies and on modules to use that config. Nitro is a good candidate for this, as most of the providers are handling these headers.

Did you want me to make a seperate issue there?

## Comentário de pi0 em 2023-08-14

I am up to supporting a special event context property such as `event.context.isTrustedProxy` to automatically enable headers detection however it should be user responsibility solely to write logic. Based on server setup it is different how to determine trustibility.

## Comentário de harlan-zw em 2023-08-14

> I am up to supporting a special event context property such as `event.context.isTrustedProxy` to automatically enable headers detection however it should be user responsibility solely to write logic. Based on server setup it is different how to determine trustibility.

Yes, I'm not concerned about users' usage, but about any integration code relying on these headers to work.

Consider this as an example: Nitro implements an in-built rate limiter, to effectively rate limit we need to know the trusted IP of the request. Nitro has no current way to know if it can trust the connecting IP, generically. This is because the x-forwarded-for header can easily be spoofed on some servers without proxies that use it.

Now blow this example up to Nuxt modules and all the other ways we need to know trusted IPs then you should have a better understanding of the problem. The solution requires multiple layers to solve, but as a starting point, we could introduce a way to filter for trusted headers similar to https://github.com/symfony/http-foundation/blob/6.3/Request.php#L2004.

Maybe this issue is better solved completely at a nitro level though

## Comentário de pi0 em 2023-08-14

Thanks for explaining your use cases. I think it makes sense to introduce a standard context flag down the line from h3 directly so that the ecosystem (nitro, nuxt, nuxt modules) can rely on it to see either they can trust + h3 itself to optimize it's behavior when proxy is trusted to use the header for default `event.url` 💯 

What I am not sure about and hesitated, is the logic to detect if we can trust proxy being directly in h3. it might be in nitro because nitro is provider aware and can include logic for this. same as symfony which is more a full-featured framework. h3 is too way low-end for this. 

What i suggest is to:
- Introduce `event.context.trustedHeaders: string[] | undefined`
- Use trusted headers for internal utils behavior auto adjustment
- Propose a plugin for nitro that can auto set `event.context.trustedHeaders`


I am still up to support any idea that can be on h3 level, platform agnostic and surely secure as we promise the function is!

## Comentário de atinux em 2023-08-14

I really like this discussion :)

I like the `event.context.trusedHeaders` option, not sure if the `trustedHeaders` could be given when creating the app though? https://github.com/unjs/h3/blob/588c8a3d9b1e408f36a1f51a43d759534245029f/src/app.ts#L50-L62

I don't know in term of performance if this will have an impact or not
