# Issue #1238: setCookie applies cookie twice when set cookie with path

Estado: CLOSED. Criada em 2025-11-04, fechada em 2025-11-09. Autor: hahavenn.

### Environment

- Node ->  25.1.0
- nvm -> 0.40.3
- npm -> 11.6.2
- nuxt -> 4.2.0
- h3 -> ^1.15.4 (saw in node_modules/nuxt/node_modules/h3/package.json)

### Reproduction

```typescript
setCookie(event, "access_jwt", "some_access", {
  maxAge: 900,
  httpOnly: true,
  secure: true,
  sameSite: true,
});
setCookie(event, "refresh_jwt", "some_refresh", {
  maxAge: 21600,
  httpOnly: true,
  secure: true,
  sameSite: true,
  path: "/api/auth/refresh",
});
```

### Describe the bug

When call provided code - some cookie sets twices. On screenshot you can see, that refresh_jwt was set twice, but setCookie was called only once for refresh_jwt

Where request was sent -> /api/auth/signup

<img width="426" height="539" alt="Image" src="https://github.com/user-attachments/assets/01676544-9479-44ca-aa84-96120b4f8a4b" />

### Additional context

I think it is problem of having `path`  in `serializeOptions`. Because when i was trying to understand this strange behavior - it was only reproduced with `path` option provided

I also can give you clear reproduction in real project, if you need (my pet-project available in my profile). Ask me if you need it (i don't know am i allowed to post other repos here)

Also what i mentioned - `setCookie` first called with empty cookies and then it 'rewrites' with new cookie

<img width="1280" height="676" alt="Image" src="https://github.com/user-attachments/assets/b254dfb2-1101-42f9-b675-2e9724de2672" />

Thanks for your help!



### Logs

```sh

```

## Comentário de hahavenn em 2025-11-04

Also, i looked in source code and see that function `getDistinctCookieKey` relies on path. So when if path provided - it will be different cookie for set due to code. I don't know maybe it is right thing

```typescript
function getDistinctCookieKey(name, opts) {
  return [name, opts.domain || "", opts.path || "/"].join(";");
}
```

## Comentário de kricsleo em 2025-11-07

Cannot reproduce with the code provided. Could you provide a minimal reproduction, like [this](https://stackblitz.com/edit/github-6c7fwhqg?file=h3.mjs) (you can try this example locally, and it doesn't reproduce)? 🙏

## Comentário de hahavenn em 2025-11-08

@kricsleo 

> Cannot reproduce with the code provided. Could you provide a minimal reproduction, like [this](https://stackblitz.com/edit/github-6c7fwhqg?file=h3.mjs) (you can try this example locally, and it doesn't reproduce)? 🙏

To see what exactly happening - you should send request to provided path, which set in setCookie options (not for "/", i mention it in issue description). Also better way to see actual cookies - use browser devtools with opened request headers (like on my screenshot)

As actual reproduction - i can give you my project, where i faced this behavior. Do you need it and can i do it? (it's open source with mit licence, without any advertisement)

## Comentário de kricsleo em 2025-11-08

Yeah, I tried as you described, but still can't reproduce. Could you please confirm with [this](https://stackblitz.com/edit/github-6c7fwhqg?file=h3.mjs)?

<img width="1504" height="626" alt="Image" src="https://github.com/user-attachments/assets/503b9eeb-a71d-423f-b37f-7be78765e1b6" />

## Comentário de hahavenn em 2025-11-08

I tried to reproduce with your code - no reproducing, all legit and good. We can close bug. I think problem is in front of my monitor. Sorry for bothering :(

But i have to ask. Does any bad side effects can be created, when working with `event` variable outside `defineEventHandler`?

For example if i want to call some util, that decides what response code will be set

Something like that:
```typescript
// some_route.post.ts
import someUtil from "somewhere.ts"

export default defineEventHandler({
  async handler(event) {
    someUtil(event);
    return { ok: true };
  },
});
```

And `someUtil` will have this definition:
```typescript
// somewhere.ts

export default function(event: any) {
  setCookie(event, "name", "value", { })
}
```

Can it leads to duplicating cookies setting? Because i tried to reproduce without this "type of code" - and it worked as you wrote. But my implementation is duplicating cookies

Is there any others possibilities to work with `event` variable outside event handlers, but with proper typing(without any type) and functional-correct? Because i has at least 3 endpoints, that share same part of code for 100 lines with multiple conditions, database processes and so on. It would be lifesaver for create such 'reuseable handling' with provided `event` object

## Comentário de hahavenn em 2025-11-08

My code is looks like this, that causes bug appearance 

[Endpoint](https://github.com/hahavenn/better/blob/main/server/api/auth/refresh.post.ts)
[Util that sets cookies](https://github.com/hahavenn/better/blob/main/server/utils/JWTGenerator.ts)
