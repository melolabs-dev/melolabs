# Issue #708: Nested route only works with double slashs at end???????

Estado: CLOSED. Criada em 2024-03-18, fechada em 2025-06-04. Autor: silvercent011.

### Environment

h3 - 1.11.1
node - 18
  

### Reproduction

```ts
import { createApp, createRouter, defineEventHandler, useBase } from "h3";

export const app = createApp();

const router = createRouter();

const apiRouter = createRouter();

apiRouter.get(
  "/",
  defineEventHandler((event) => {
    console.log("Hello from router!");
    return { message: "Hello from router!" };
  })
);

router.use("/api/**", useBase("/api", apiRouter.handler));

app.use(router);

```

### Describe the bug

The nested router, only works if the path have two slashes at end of url, `http://localhost:3000/api//`, without double slash, throw a 404 error.

### Additional context

_No response_

### Logs

_No response_

## Comentário de nozomuikuta em 2024-03-18

Would you provide a minimal reproduction instead of just showing the code?
Although you seem to have just copied and modified [the code from documentation](https://h3.unjs.io/utils/advanced#usebasebase-handler), runnable reproduction is much helpful for maintainers. 🙌 

You can use [StackBlitz](https://stackblitz.com/), for example.

One of benefits of providing it is that we could folk your code and share fixed version if it's just a mistake.
Otherwise, we will dig into the issue.

## Comentário de silvercent011 em 2024-03-18

https://stackblitz.com/edit/stackblitz-starters-krifhq?file=src%2Fapp.ts

## Comentário de nozomuikuta em 2024-03-18

Thank you for providing the reproduction!!
Now it's much easier to debug! 🙏 

As far as I checked, there seems to be a bug in h3 routing.
The root cause would exist in `useBase` of h3, or https://github.com/unjs/radix3/issues/84 might be related.

At the moment, one workaround is to stop using top-level router and let api router look up its routes.

https://stackblitz.com/edit/stackblitz-starters-ygfkoc?file=src%2Fapp.ts

## Comentário de silvercent011 em 2024-03-18

ok, thanks for the support @NozomuIkuta  :)

Should I close the issue or leave it open for resolution of the bug/documentation/or similar?

## Comentário de nozomuikuta em 2024-03-18

My pleasure.
Would you keep it open for governance so that author can recognize this issue?

## Comentário de silvercent011 em 2024-03-18

Yep!
