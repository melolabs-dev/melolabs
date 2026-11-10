# Issue #603: Default content-type `text/html` used in 304 responses of static assets

Estado: CLOSED. Criada em 2024-01-02, fechada em 2024-01-25. Autor: grob.

### Environment

Node 18, Nuxt 3.8.2, Nitro 2.8.1

### Reproduction

none

### Describe the bug

Ran into this issue using Nuxt in production mode and a static `.svg` asset.

H3 uses the default content-type `text/html` for 304 responses. Apparently this happens in [handleHandlerResponse](https://github.com/unjs/h3/blob/53703dc860f1ff6fe7ce71d543deff1cfa810b11/src/app.ts#L255) - 304 responses have an empty string body, and the function [defaultContentType](https://github.com/unjs/h3/blob/53703dc860f1ff6fe7ce71d543deff1cfa810b11/src/utils/response.ts#L78) called subsequently only checks if the `content-type` header has been set already, but **not** if the response code is 304. Thus the default content type `text/html` is applied.

[RFC 7232 suggests](https://www.rfc-editor.org/rfc/rfc7232#section-4.1) that 304 responses should not contain a `content-type` header, so i think checking the response code too in `defaultContentType()` should be sufficient (although i'm not sure if this would be the right spot to change).

See also https://github.com/unjs/nitro/issues/1700

### Additional context

_No response_

### Logs

_No response_

## Comentário de grob em 2024-01-11

Btw: this affects **all static assets** of Nuxt (js, css …) - imho just the `immutable` Cache-Control header prevents this bug from wreak havoc.

## Comentário de Jamie4224 em 2024-01-11

@grob It already wreaks havoc when Nuxt is used in conjunction with Google Cloud CDN, sadly enough. Cloud CDN picks up the text/html content-type on a cache validation call. After that browsers block these static assets from loading since strict mime checks fail.

## Comentário de grob em 2024-01-12

@Jamie4224 did you find a workaround (or temporary fix)? we're currently re-applying the content-type of the stale (= cached) version in varnish for 304 responses from nuxt …

## Comentário de Jamie4224 em 2024-01-12

@grob No, our workaround was disabling Cloud CDN for the moment. The only other workaround I see is forcefully applying a content-type based on the extension (probably what you are doing?).

## Comentário de grob em 2024-01-12

Unfortunately i have no experience with cloud cdn - as i said, we're currently using the content-type of the cached (http 200) version of a response whenever the backend (= nuxt) returns a 304. sadly enough, that's the only way we could fix it, but fortunately varnish allows to do that. still it's pretty disappointing.
