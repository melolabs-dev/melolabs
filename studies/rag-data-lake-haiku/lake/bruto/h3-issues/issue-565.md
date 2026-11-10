# Issue #565: Adding an authorization header to the request in server middleware

Estado: CLOSED. Criada em 2023-10-30, fechada em 2024-02-16. Autor: Birleyici.

### Describe the feature


I'm using h3 built into nuxt. I need to be able to set a header to add a bearer token to the request in the server middleware.I tried every way but I couldn't succeed. How can I do this in the block below?

server/middleware/addBearerToken.js
```

export default fromNodeMiddleware((req, res, next) => {

  
    const token = 'TOKEN'
    
      // ---HERE---
      //How can I set my token to the headers ?
      
    next();
});
```


### Additional information

- [ ] Would you be willing to help implement this feature?

## Comentário de peterroe em 2023-10-30

Hi, Maybe you can do like this:
```ts
fromNodeMiddleware((req, res, next) => {
    req.setHeader("token", "token");
    next();
}),
```

## Comentário de Birleyici em 2023-10-31

> ```ts
>     req.setHeader("token", "token");
> ```

Hi, I tried this before and I encounter the following error.

```
500
req.setHeader is not a function

at null. (C:\Users\HP\Desktop\BeyrahaV2\server\middleware\deneme.js:2:1)
at /C:/Users/HP/Desktop/BeyrahaV2/node_modules/h3/dist/index.mjs:1876:24
at new Promise ()
at callNodeListener (/C:/Users/HP/Desktop/BeyrahaV2/node_modules/h3/dist/index.mjs:1867:10)
at Object.handler (/C:/Users/HP/Desktop/BeyrahaV2/node_modules/h3/dist/index.mjs:1829:12)
at Object.handler (/C:/Users/HP/Desktop/BeyrahaV2/node_modules/h3/dist/index.mjs:1630:31)
at processTicksAndRejections (node:internal/process/task_queues:96:5)
at async toNodeHandle (/C:/Users/HP/Desktop/BeyrahaV2/node_modules/h3/dist/index.mjs:1840:7)
at async ufetch (/C:/Users/HP/Desktop/BeyrahaV2/node_modules/unenv/runtime/fetch/index.mjs:9:17)
at null.errorhandler (C:\Users\HP\Desktop\BeyrahaV2\node_modules\nuxt\dist\core\runtime\nitro\error.js:35:30)
```

server middleware file:


```
export default fromNodeMiddleware((req, res, next) => {

  req.setHeader("token", "token");
  next()

})
```

## Comentário de ceodevforce em 2023-12-03

@Birleyici you can setting it to the context or using cookies that work too

## Comentário de platform-kit em 2023-12-23

@ceodevforce this issue shows up when you use Nuxt3/Nitro to ship to Netlify. 

`getHeader` works as expected when running locally under `node-server` preset. But not once the lambdas are built and deployed to Netlify Functions/lambda.

Obviously, headers, especially `authorization` are something devs need to use. Workarounds like cookies etc won't work.

Any ideas about how to fix this?

## Comentário de titan-65 em 2023-12-23

Ok, I get what you are saying however, since cookies are out have you tried using the nuxt context or using the event instead of getHeader like this `const token = event.node.req.headers('Authorization') || event.node.req.headers('authorization') || getCookie(event, 'token') || h3Header(event, 'token') || h3Query(event, 'token') || h3Cookie(event, 'token')`. I took this from a package I have been working on here [j3-Jwt](https://www.npmjs.com/package/h3-jwt)

## Comentário de platform-kit em 2023-12-23

@titan-65  `event.node.req.headers` is undefined in Netlify functions context.
