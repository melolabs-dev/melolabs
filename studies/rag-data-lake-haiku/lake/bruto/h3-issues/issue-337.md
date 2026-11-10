# Issue #337: `useSession` throws unsupported error in stackblitz 

Estado: CLOSED. Criada em 2023-02-18, fechada em 2023-07-20. Autor: angelhdzmultimedia.

### Environment

**Node:** 16.14.2
**IDE:** stackblitz.com
**pnpm:** 7.13.6
**nuxt:** 3.2.2
**h3:** 1.5.0

### Reproduction

https://stackblitz.com/edit/nuxt-starter-scbadp?file=server%2Fapi%2Fcount.get.ts

### Describe the bug

![image](https://user-images.githubusercontent.com/10191085/219824671-aa1906c4-0fed-4c4b-b7ac-700392eae131.png)


### Additional context

_No response_

### Logs

_No response_

## Comentário de angelhdzmultimedia em 2023-02-18

### Update

I intended to post this in the nuxt repo. Got confused.
But yeah, they are related.

I tried using a server middleware using h3 directly with its own http server and host/port, to rule out any incompatibility of session with nuxt, but still got error:

![image](https://user-images.githubusercontent.com/10191085/219838231-0bb95387-a515-40e3-81af-1ab73cfe321c.png)

The server per se is receiving the request from the client (app.vue), and returning the value.
The error comes the moment I add session.

![image](https://user-images.githubusercontent.com/10191085/219838879-51a95dd9-c88d-416f-8688-6a6ab578ae2f.png)

## Comentário de ashutosh887 em 2023-03-01

@angelhdzmultimedia I would like to work on it

## Comentário de angelhdzmultimedia em 2023-03-02

> @angelhdzmultimedia I would like to work on it

Thank you! I hope you can find a solution.

## Comentário de angelhdzmultimedia em 2023-03-03

### Update

I'm not very knowledgable about debugging, but I managed to know where the error starts.

I started by copying all the session hooks like `getSession`, `updateSession` and `useSession `manually in my code from the source code (of course, installed and imported all dependencies like `cookie-es`, `uncrypto`, and `iron-webcrypto`).

Then added `debugger `statements.

First, the `useSession` calls `getSession`.

Then `getSession` calls `updateSession`, and `updateSession` calls `toNodeListener`, which has a closure `toNodeHandler ` and returns it. Well, the `Unsupported 500` error comes from that closure.

![chrome_LQqVcHNy9K](https://user-images.githubusercontent.com/10191085/222728798-f1070a35-2188-495d-98ae-a1ff640073d7.png)

## Comentário de angelhdzmultimedia em 2023-03-15

> @angelhdzmultimedia I would like to work on it

Not rushing. Just want to know the status, to know if I will wait for this to be solved, or explore `sidebase/nuxt-session`. Thank you!

## Comentário de pi0 em 2023-03-28

Hi. This issue seems from stackblitz only not supporting some web crypto methods used to encrypt the session. If you run it locally, it works.

(small note, in `count.get.ts` line 10, you forgot an `await` for `session.update`)

Keeping this issue open until investigating more on stackblitz side.
