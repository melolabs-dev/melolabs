# Issue #717: Event stream "onClosed" callback not firing on Nuxt

Estado: CLOSED. Criada em 2024-03-21, fechada em 2025-10-24. Autor: brunohstein.

### Environment

- h3 nightly
- Nuxt 3.11.1
- Node 18.18.0

### Reproduction

I expected the server to log the message on `eventStream.onClosed` callback but that didn't happen.

<img width="407" alt="Captura de Tela 2024-03-21 às 09 04 36" src="https://github.com/unjs/h3/assets/1143565/c4a70b57-49ff-4f72-a50c-af09e500037d">

I also expected it to log on `node.req` "close" event as well, so I'm confused if I'm getting something really wrong. (About this I found [this post](https://github.com/nuxt/nuxt/discussions/22535) that reports a similar problem)

https://stackblitz.com/edit/nuxt-starter-aa9nxb?file=pages%2Findex.vue

### Describe the bug

Hi! I'm experimenting with the new SSE support and having some trouble to close listeners and connections when the SSE request connection is closed. If I'm not missing something, it looks like `onClosed` should be fired but it's not.

### Additional context

_No response_

### Logs

_No response_

## Comentário de brunohstein em 2024-03-23

Probably related: https://github.com/unjs/nitro/issues/1515.

Should this issue be handled in unjs/nitro or even nuxt/nuxt?

## Comentário de Moonlight63 em 2024-08-31

I just ran in to the same isse. I can close the connection on the fronend by calling close() on the eventsource, but the server end never closes connection, so I can't clean up my event listeners properly. Trying to find a work around.

## Comentário de ilyasturki em 2025-03-04

I have the same issue as you guys.

The strange thing is that the onClosed callback worked at the beginning, but now it doesn't despite not updating anything.

Did you manage to find a workaround or something ?

## Comentário de kricsleo em 2025-04-24

> https://stackblitz.com/edit/nuxt-starter-aa9nxb?file=pages%2Findex.vue

The reproduction you provided seems to be a StackBlitz-specific issue, as the problem occurs in the StackBlitz playground but works fine locally.

<img width="918" alt="Image" src="https://github.com/user-attachments/assets/35d5ddff-0e3b-49ea-8aa9-e7c4b3bf7ea7" />

I've also tested other libraries, such as [Hono - streamSSE](https://hono.dev/docs/helpers/streaming#streamsse):
https://stackblitz.com/edit/vitejs-vite-qrxe2ipf?file=package.json,src%2Findex.ts&terminal=dev
This also works fine locally, but the `abort` event doesn't fire in StackBlitz.

Could you provide a minimal GitHub repository that reproduces this issue locally? 🙏

## Comentário de pi0 em 2025-06-04

Closing as no minimal reproduction provided.

## Comentário de Kylyi em 2025-10-23

Im having the same issue on local environment.

The very simplest repro (using VueUse) is:

<img width="1458" height="410" alt="Image" src="https://github.com/user-attachments/assets/682e6376-2988-4c1c-9685-054a96630ab2" />

Nuxt@4.1.3
VueUse@14.0.0

GH repo: https://github.com/Kylyi/v4

I'm assuming that using the `close` method from `useEventSource` should trigger the `stream.onClosed` and as @Yasso9 mentioned, I'm fairly sure this worked at some point.
