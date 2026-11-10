# Issue #1053: infer route params

Estado: OPEN. Criada em 2025-05-11. Autor: huseeiin.

### Describe the feature

```ts
import { H3 } from "h3-nightly" // 2.0.0-20250428-102154-f1115f3;

const app = new H3();

app.get("/:user/id", (e) => {
  console.log(e.context.params); // Record<string, string> | undefined;
});
```
could this be helpful? https://github.com/lukeed/regexparam/blob/main/index.d.ts#L11

### Additional information

- [ ] Would you be willing to help implement this feature?

## Comentário de pi0 em 2025-05-12

/cc @danielroe Do you think we could have a mini util from fetch-dts to unblock this? (bun also has similar feature in their types)

## Comentário de huseeiin em 2025-05-13

> /cc [@danielroe](https://github.com/danielroe) Do you think we could have a mini util from fetch-dts to unblock this? (bun also has similar feature in their types)

but we should make sure it 100% matches `rou3` conventions

## Comentário de medz em 2025-06-04

> /cc [@danielroe](https://github.com/danielroe) Do you think we could have a mini util from fetch-dts to unblock this? (bun also has similar feature in their types)

In addition to Bun, there is also SvelteKit. If H3 supports this feature, Nitro will benefit greatly.

## Comentário de huseeiin em 2025-08-03

i think the util that will be created to infer params from a string should be exported by rou3 too :)

## Comentário de pi0 em 2025-08-03

Feel feee to open Issue and work on PR for rou3 @huseeiin 😊

## Comentário de huseeiin em 2025-08-03

> Feel feee to open Issue and work on PR for rou3 [@huseeiin](https://github.com/huseeiin) 😊

unfortunately i'm not a typescript type magician xd
