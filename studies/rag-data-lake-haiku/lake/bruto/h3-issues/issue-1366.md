# Issue #1366: Enable global opt-in for xForwardedFor/xForwardedHost options

Estado: CLOSED. Criada em 2026-04-11, fechada em 2026-05-01. Autor: septatrix.

### Describe the feature

When h3 is used deeper in the stack like in https://github.com/atinux/nuxt-auth-utils, it is not possible for the developer to control the xForwarded* options. This cases issues as the app resolves a wrong URL for stuff like `redirect_uri` (in the case of nuxt-auth-utils). The only remedy in that case is to hardcode the redirect URI with a runtime option.
Either in h3 or somehow in a higher layer like nitro it should be made possible to enable that flag by default for all requests

### Additional information

- [ ] Would you be willing to help implement this feature?

## Comentário de pi0 em 2026-05-01

In modern H3 v2 / Nitro v3, `event.req.ip` is standard and universal way to access request IP.

You can use a plugin to fill it with any value. But a strong note: `x-forwarded-for` header shoudlt not be blindly trusted unless we are sure behind a CDN or reverse proxy that always sets it.

## Comentário de pi0 em 2026-05-01

Hopefully Nuxt will migrate to latest versions soon closing in meanwhile.

## Comentário de septatrix em 2026-05-01

> In modern H3 v2 / Nitro v3, `event.req.ip` is standard and universal way to access request IP.
> 
> You can use a plugin to fill it with any value.

Something as commonly used as forward headers should have support built-in. Would you be fine with an issue in the Nitro or Nuxt repo for providing such a plugin natively?

## Comentário de pi0 em 2026-05-01

Please try nitro v3 first.

## Comentário de katywings em 2026-05-06

@pi0 I think what @septatrix meant was that you not always have access to the code that runs `getRequestURL`. Said code might be in some dependency. Now if you use said dependency and your app runs behind a proxy, you are not able to enable `xForwardedHost` - unless said dependency specifically allows configuring it. So if I get @septatrix correctly, what they ask for is e.g. a global function in h3 to configure the default value of xForwardedHost:

```tsx
import { setDefaults } from "h3";
setDefaults({
  xForwardedHost: true
})
```

Having this possibility would also open it up, to make this configurable via environment variable.

## Comentário de pi0 em 2026-05-06

Thanks for clarification dear @katywings but i still believe it will be something unsafe specially if we allow H3 to change it's behavior based on environment side-effects. An internal unrelated H3 app might wrongly start to accept x-forwarded headers.

If middle layers can really "guarantee" safety they can probably enable flag in their usage but it is very unlikely because weather if we can trust xforwarded headers depends on deployment.

srvx and nitro v3 approach to this is they provide `ServerRequest.ip`, it can be also overiden or set by framework or users and it is guaranteed to be valid at least how srvx and nitro presets fill it (when it is safe it also respects x-forwarded headers)
