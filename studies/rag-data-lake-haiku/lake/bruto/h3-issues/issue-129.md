# Issue #129: support additional generic for typing incoming body & query

Estado: CLOSED. Criada em 2022-06-04, fechada em 2023-07-27. Autor: danielroe.

would support something like this:

```js
export default defineEventHandler<{ result: string }, { foo: string }>(async event => {
  const { foo } = await useBody(event)
  return {
    result: foo
  }
})

const result = await $fetch('/api/test', {
  body: {
    // auto-completing body, requiring 
  }
})
```

**Follow-up tasks**
- [ ] add support for typing query/body in Nitro generated types & ohmyfetch (via options)

possibly could also consider params?

## Comentário de kevinmarrec em 2022-06-04

@danielroe Does `useQuery` & `useBody` already provides generic type ?

I also had schema validation Idea that could be implemented within the composables, like `useBody` handling bad requests using JSON schema type builder like https://github.com/sinclairzx81/typebox . `useBody` could then infer type from schema

## Comentário de pi0 em 2022-06-04

Love the ideas!

`useBody` accepts type generic (`useParams` doesn't. PR welcome to add!)

We can introduce request validation with an external package like `h3-typebox` exposing `useValidatedBody(event)` with type inference and wrapping `useBody`. Later we might introduce a built-in util based on ajv/untyped or more h3 tailored DX.

I guess would be safer if we namespace second genetic for extensibility like `{ body: {}, query: {} }`. But how do you plan to type `useBody` call within `defineEventHandler` without explicitly giving generic to it @danielroe

## Comentário de kevinmarrec em 2022-06-04

Will be glad to help you guys on this stuff 🚀

## Comentário de pi0 em 2022-06-04

Feel free to initiate h3-typebox @kevinmarrec ❤️ You can use unjs/template for starter.

## Comentário de wobsoriano em 2022-06-09

Now, this is awesome! With `express` and `zod` for example, you can type the body like this:

```ts
import { Request, RequestHandler, Response } from 'express';

export const validateRequestBody: <TBody>(
  zodSchema: ZodSchema<TBody>,
) => RequestHandler<ParamsDictionary, any, TBody, any> = (schema) => (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (parsed.success) {
    return next();
  } else {
    return res.status(400).send(parsed.error)
  }
};
```

```ts
import { validateRequestBody } from './validation'
import { z } from 'zod';

app.get("/", validateRequestBody(
    z.object({
      name: z.string(),
      age: z.number(),
    })
  ), (req, res) => {
    // req.body is now strictly-typed and confirms to the zod schema above.
    // req.body: { name: string, age: number };
  }
);
```

I think we should accept any TypeScript schema validator (zod,typebox,yup). I'm thinking something like:

```ts
import { z } from 'zod'
import { someResolverFn } from 'your-library'

const schema = z.object({
  name: z.string(),
  age: z.number(),
})

useValidatedBody(event, {
  resolver: someResolverFn(schema)
})
```

```ts
import { object, string, number } from 'yup'
import { someResolverFn } from 'your-library'

const schema = object({
  name: string().required(),
  age: number().required().positive().integer()
})

useValidatedBody(event, {
  resolver: someResolverFn(schema)
})
```

## Comentário de kevinmarrec em 2022-06-12

I just released [h3-typebox](https://www.npmjs.com/package/h3-typebox) ([source](https://github.com/kevinmarrec/h3-typebox)) 🚀

Feedbacks are welcome !
