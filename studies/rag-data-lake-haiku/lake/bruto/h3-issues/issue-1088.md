# Issue #1088: defineRoute

Estado: OPEN. Criada em 2025-06-05. Autor: productdevbook.

### Describe the feature

In CLI and codebase scanning architectures, type inference and code merging often create inconsistencies with methods like .get, .post, etc., leading to a different set of challenges in every project. To prevent this and achieve a strictly consistent system, introducing a new structured approach unlocks many bottlenecks. In the modern ecosystem, support for StandardSchema significantly simplifies module development—even in specialized modules like OpenAPI and others.


```ts
import { H3, defineEventHandler, defineRoute, readBody, readValidatedBody } from "h3";
import { z } from "zod";

export const book = defineRoute({
  method: "GET",
  route: "/api/books",
  routerParams: z.object({
    id: z.string(),
  }),
  queryParams: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
  input: z.object({ 
    title: z.string(),
  }),
  output: z.object({
    message: z.string(),
    name: z.string(),
  }),
  handler: async (event)=> {
    const data = await readBody(event);
    const data2 = await readValidatedBody(event)

    return {
      message: "Book list",
      name: ''
    }
  }
});


const app = new H3();

app.addRoute(book);
```




### Additional information

- [x] Would you be willing to help implement this feature?

## Comentário de zsilbi em 2025-06-05

This looks familiar from libraries like https://github.com/ts-rest/ts-rest and https://github.com/unnoq/orpc
I think it would be great to make this compatible with these too.

I'd personally like if there were:
 - `headers` support with `Record<string, StandardSchemaV1>`
 - output would be a `Record<StatusCode, StandardSchemaV1>` so with a `someResponseHelper(<statusCode>, <my-response>)` we could validate the output types before returning them from the handler (and the handler would by default allow a union of these to be returned)
 - the `route` would be also defineable without a handler that can be later "implemented" with one, so clients (in browser) can also use the defined contracts without any server code leaking into that
 
```ts
import { H3, defineEventHandler, defineRoute, readBody, readValidatedBody } from "h3";
import { z } from "zod";

export const book = defineRoute({
  method: "GET",
  route: "/api/books",
  routerParams: z.object({
    id: z.string(),
  }),
  queryParams: z.object({
    page: z.string().optional(),
    limit: z.string().optional(),
  }),
  headers: {
    "x-custom-header": z.string().optional(),
  },
  input: z.object({
    title: z.string(),
  }),
  output: {
    200: z.object({
      message: z.string(),
      name: z.string(),
    }),
    204: z.void(),
    404: z.object({
      message: z.string(),
      statusCode: z.literal(404),
    })
  },
  handler: async (event) => {
    const data = await readBody(event);
    const data2 = await rea

## Comentário de pi0 em 2025-06-05

`defineRoute` looks very clean way to declare routes and register later, especially for composition in an H3-only project.

My main concern would be that we will eventually put too much opinion into `defineRoute` util, which makes it less flexible or extendable. Universal (client) route definitions are an interesting example @zsilbi mentioned. Also, in Nitro, we have a separate `defineRouteMeta` that is statically extractable.

I am thinking we could take a more generic approach to this, unblocking h3 core first.

## `app.register(spec)`

Right now, we do have several methods `app.use` (for middleware), `app.[method]`/`app.all`/`app.on` for routes, and `app.mount` for fetch-compatible handlers.

While they are ergonomic to register things in place (one file), they are not declarative enough to compose from multiple places, which makes a proposal like `app.addRoute(defineRoute())` immediately sensible.

From H3 core itself, we could support a declarative object register method. And this object could be made with different abstractions, an `addRoute` that only specifies route/method or different ways of validation, or RPC, etc.

It could start as simple as something like this:

```js
app.register({ route: { method, route, handler } })
```

Then a `defineRoute` util, either from h3 core, an external/opininated library or nitro, can generate this object (`app.register(defineRoute({}))`), or even multiple versions of it, for example nitro can make one without handler but only meta

## Comentário de pi0 em 2025-06-09

I have ended up adding a more generic plugin interface in #1098 

Imaginary implementation example for `app.register(route)` using experimental `defineValidatedHandler` (#1097)

```js
// Plugin
const defineRoute = (routeObj) => definePlugin((app) => {
  app.on(routeObj.method || "", routeObj.route, defineValidatedHandler(routeObj))
})

// Define routes
const book = defineRoute({ method: "get", route: "/book", handler: () => "Hello World!" })

// Register Routes (as plugin)
const app = new H3().register(book())
```

## Comentário de productdevbook em 2025-06-10

actually my plugins dream was like this.

```ts
import { H3, defineEventHandler, defineRoute, readBody, readValidatedBody } from "h3";
import { z } from "zod";

export const book = defineRoute({
  method: "GET",
  route: "/api/books",
  plugins: [
   (event)=> {},
  ],

  ......
```

## Comentário de pi0 em 2025-06-10

- middleware can hook to request (`event`)
- plugins can hook to h3 instance (`app`)
   - and they can add middleware too!

In your example this works as intended:

```js
export const book = defineRoute({
  method: "GET",
  route: "/api/books",
  middleware: [
   (event)=> {},
  ],
```

## Comentário de productdevbook em 2025-06-10

I think a name change is necessary.  

middleware -> plugin

```ts
export const book = defineRoute({
  method: "GET",
  route: "/api/books",
  plugin: [
   (event)=> {},
  ],
```


and Plugin -> Module
```ts
// Module
const defineRoute = (routeObj) => defineModule((app) => {
  app.on(routeObj.method || "", routeObj.route, defineValidatedHandler(routeObj))
})
```
