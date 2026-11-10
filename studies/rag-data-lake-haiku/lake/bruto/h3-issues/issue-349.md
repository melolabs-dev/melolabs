# Issue #349: How to annotation query type?

Estado: CLOSED. Criada em 2023-03-03, fechada em 2023-08-01. Autor: maicss.

### Environment

node : 18.12.1
nuxt: 3.0.0
h3: 1.0.2

### Reproduction

export default defineEventHandler(async (event) => {
  const { res } = event.node
  const { code, name, someNumber } = getQuery(event)
})

### Describe the bug

`code`, `name`, `someNumber` types are infer to  `string | QueryValue[] | null`

How do I give types of them? Not where I use them with `as` assert.
like:
```
const handle Query = (code: string, name: string, index?: number) => {}
handleQuery (code as string, name as string, someNumber as number)
```

### Additional context

_No response_

### Logs

_No response_

## Comentário de oleghalin em 2023-03-03

`getQuery` doesnt accept generic, so for now you can mark it as type using `as` construction 

```
const query = getQuery(event) as Query;
```

## Comentário de maicss em 2023-03-03

OK, fine.
Will you consider `getQuery<xxx>(event)` ?

## Comentário de oleghalin em 2023-03-03

@pi0 is there any reason why getQuery doesnt accept generics? If no any problems with it i will be happy to contribute for this

## Comentário de maicss em 2023-03-03

It's sooo ugly, should unknow first.
```
const query = getQuery(event) as unknown as Query;
```

## Comentário de oleghalin em 2023-03-03

> It's sooo ugly, should unknow first.
> 
> ```
> const query = getQuery(event) as unknown as Query;
> ```

I think as soon as Query implements `Record<string, QueryValue | QueryValue[] >` assigning it to getQuery is ok, but i can be wrong

## Comentário de pi0 em 2023-03-03

PR welcome to support generic type 🙏
