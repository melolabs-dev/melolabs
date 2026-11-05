// Gabarito oculto: h3js/h3#1267 (HTTP Range no serveStatic). Norma: RFC 9110 seção 14 (antiga RFC 7233).
// Roda nos alvos "web" e "node" via describeMatrix, como test/static.test.ts.
// Todas as requisições do mock principal mandam `accept-encoding` explícito: o fetch do
// Node acrescenta `accept-encoding: gzip, deflate` quando o cabeçalho falta, o que trocaria
// a representação servida (`/test.png.gz`, 18 bytes) só no alvo "node".
import { readFileSync } from "node:fs";
import { beforeEach, describe, it, expect, vi } from "vitest";
import * as h3 from "../src/index.ts";
import * as staticModule from "../src/utils/static.ts";
import { serveStatic, type ServeStaticOptions } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const identity = { "accept-encoding": "identity" };

describeMatrix("serve static range (#1267)", (t, { it, expect }) => {
  beforeEach(() => {
    // Mesmo mock de test/static.test.ts: corpo `asset:<id>`, size = tamanho desse corpo.
    const serveStaticOptions: ServeStaticOptions = {
      getContents: vi.fn((id) => (id.includes("404") ? undefined : `asset:${id}`)),
      getMeta: vi.fn((id) =>
        id.includes("404")
          ? undefined
          : {
              type: "text/plain",
              encoding: "utf8",
              etag: "w/123",
              mtime: 1_700_000_000_000,
              path: id,
              size: `asset:${id}`.length,
            },
      ),
      indexNames: ["/index.html"],
      encodings: { gzip: ".gz", br: ".br" },
      headers: {
        "cache-control": "public, max-age=86400",
      },
    };

    // Asset com entity-tag forte (sintaxe válida da RFC 9110 seção 8.8.3), para If-Range.
    // O etag `w/123` do mock principal não é um entity-tag válido.
    t.app.all("/strong/**", (event) =>
      serveStatic(event, {
        getContents: (id) => `asset:${id}`,
        getMeta: (id) => ({
          type: "text/plain",
          etag: '"abc"',
          mtime: 1_700_000_000_000,
          size: `asset:${id}`.length,
        }),
      }),
    );

    t.app.all("/**", (event) => {
      return serveStatic(event, serveStaticOptions);
    });
  });

  // "asset:/test.png" tem 15 bytes; "asset:/test.png.gz" tem 18 bytes.

  it("R1: GET sem Range responde 200 completo com accept-ranges: bytes", async () => {
    const res = await t.fetch("/test.png", { headers: identity });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset:/test.png");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-length")).toBe("15");
  });

  it("R2: Range bytes=0-4 responde 206 com o intervalo", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=0-4" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("asset");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/15");
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("R3: Range aberto bytes=10- vai até o fim", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=10-" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("t.png");
    expect(res.headers.get("content-range")).toBe("bytes 10-14/15");
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("R4: Range de sufixo bytes=-3 devolve os últimos 3 bytes", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=-3" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("png");
    expect(res.headers.get("content-range")).toBe("bytes 12-14/15");
    expect(res.headers.get("content-length")).toBe("3");
  });

  it("R5: fim além do tamanho é limitado ao último byte", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=10-99" } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("t.png");
    expect(res.headers.get("content-range")).toBe("bytes 10-14/15");
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("R6: início no tamanho ou além responde 416", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=15-20" } });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */15");
    expect(res.headers.get("content-length")).toBe("0");
    expect(await res.text()).toBe("");
  });

  it("R7: multi-range é ignorado e responde 200 completo", async () => {
    const res = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=0-1,3-4" } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset:/test.png");
    expect(res.headers.get("content-range")).toBeNull();
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });

  it("R8: Range malformado é ignorado e responde 200 completo", async () => {
    for (const range of ["abc", "bytes=5-2"]) {
      const res = await t.fetch("/test.png", { headers: { ...identity, range } });
      expect(res.status, range).toBe(200);
      expect(await res.text(), range).toBe("asset:/test.png");
      expect(res.headers.get("content-range"), range).toBeNull();
      expect(res.headers.get("accept-ranges"), range).toBe("bytes");
    }
  });

  it("R9: HEAD com Range responde 206 só com cabeçalhos", async () => {
    const res = await t.fetch("/test.png", {
      method: "HEAD",
      headers: { ...identity, range: "bytes=0-4" },
    });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/15");
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("R10: o intervalo vale para a representação codificada escolhida", async () => {
    const res = await t.fetch("/test.png", {
      headers: { "accept-encoding": "gzip", range: "bytes=0-4" },
    });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("asset");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/18");
    expect(res.headers.get("content-length")).toBe("5");
    expect(res.headers.get("vary")).toBe("accept-encoding");
  });

  it("R11: a 206 mantém os cabeçalhos de cache da 200", async () => {
    const full = await t.fetch("/test.png", { headers: identity });
    const partial = await t.fetch("/test.png", { headers: { ...identity, range: "bytes=0-4" } });
    expect(full.status).toBe(200);
    expect(partial.status).toBe(206);
    for (const name of ["etag", "last-modified", "cache-control", "vary"]) {
      expect(full.headers.get(name), name).not.toBeNull();
      expect(partial.headers.get(name), name).toBe(full.headers.get(name));
    }
  });

  it("R12: asset inexistente continua 404 e outro método continua 405", async () => {
    const notFound = await t.fetch("/404/test.png", {
      headers: { ...identity, range: "bytes=0-4" },
    });
    expect(notFound.status).toBe(404);

    const notFoundHead = await t.fetch("/404/test.png", {
      method: "HEAD",
      headers: { ...identity, range: "bytes=0-4" },
    });
    expect(notFoundHead.status).toBe(404);

    const post = await t.fetch("/test.png", {
      method: "POST",
      headers: { ...identity, range: "bytes=0-4" },
    });
    expect(post.status).toBe(405);
  });

  it("R14: If-Range com o etag atual aplica o Range", async () => {
    const res = await t.fetch("/strong/test.png", {
      headers: { ...identity, range: "bytes=0-4", "if-range": '"abc"' },
    });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe("asset");
    expect(res.headers.get("content-range")).toBe("bytes 0-4/22");
    expect(res.headers.get("content-length")).toBe("5");
  });

  it("R15: If-Range com etag diferente ignora o Range e responde 200 completo", async () => {
    const res = await t.fetch("/strong/test.png", {
      headers: { ...identity, range: "bytes=0-4", "if-range": '"xyz"' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("asset:/strong/test.png");
    expect(res.headers.get("content-range")).toBeNull();
    expect(res.headers.get("accept-ranges")).toBe("bytes");
  });
});

// R13: lista de exportações do commit base f0e17808 (v2.0.8).
const BASE_RUNTIME_EXPORTS = [
  "EventStream",
  "H3",
  "H3Core",
  "H3Error",
  "H3Event",
  "HTTPError",
  "HTTPResponse",
  "appendAcceptQuery",
  "appendCorsHeaders",
  "appendCorsPreflightHeaders",
  "appendHeader",
  "appendHeaders",
  "appendResponseHeader",
  "appendResponseHeaders",
  "assertBodySize",
  "assertMethod",
  "basicAuth",
  "bodyLimit",
  "callMiddleware",
  "clearResponseHeaders",
  "clearSession",
  "composeMiddleware",
  "createApp",
  "createError",
  "createEventStream",
  "createRouter",
  "defaultContentType",
  "defineEventHandler",
  "defineHandler",
  "defineJsonRpcHandler",
  "defineJsonRpcWebSocketHandler",
  "defineLazyEventHandler",
  "defineMiddleware",
  "defineNodeHandler",
  "defineNodeListener",
  "defineNodeMiddleware",
  "definePlugin",
  "defineRoute",
  "defineValidatedHandler",
  "defineWebSocket",
  "defineWebSocketHandler",
  "deleteChunkedCookie",
  "deleteCookie",
  "dynamicEventHandler",
  "eventHandler",
  "fetchWithEvent",
  "fromNodeHandler",
  "fromNodeMiddleware",
  "fromWebHandler",
  "getBodyStream",
  "getChunkedCookie",
  "getCookie",
  "getEventContext",
  "getHeader",
  "getHeaders",
  "getMethod",
  "getProxyRequestHeaders",
  "getQuery",
  "getRequestFingerprint",
  "getRequestHeader",
  "getRequestHeaders",
  "getRequestHost",
  "getRequestIP",
  "getRequestPath",
  "getRequestProtocol",
  "getRequestURL",
  "getRequestWebStream",
  "getResponseHeader",
  "getResponseHeaders",
  "getResponseStatus",
  "getResponseStatusText",
  "getRouterParam",
  "getRouterParams",
  "getSession",
  "getValidatedCookies",
  "getValidatedQuery",
  "getValidatedRouterParams",
  "handleCacheHeaders",
  "handleCors",
  "html",
  "isCanonicalPath",
  "isCorsOriginAllowed",
  "isError",
  "isEvent",
  "isHTTPEvent",
  "isMethod",
  "isPreflightRequest",
  "iterable",
  "lazyEventHandler",
  "mockEvent",
  "noContent",
  "normalizeRoute",
  "onDispose",
  "onError",
  "onRequest",
  "onResponse",
  "parseCookies",
  "proxy",
  "proxyRequest",
  "raw",
  "readBody",
  "readFormData",
  "readFormDataBody",
  "readMultipartFormData",
  "readRawBody",
  "readValidatedBody",
  "redirect",
  "redirectBack",
  "removeResponseHeader",
  "removeRoute",
  "requestWithBaseURL",
  "requestWithURL",
  "requireBasicAuth",
  "requireContentType",
  "resolveDotSegments",
  "sanitizeStatusCode",
  "sanitizeStatusMessage",
  "sealSession",
  "sendIterable",
  "sendNoContent",
  "sendProxy",
  "sendRedirect",
  "sendStream",
  "sendWebResponse",
  "serveStatic",
  "setChunkedCookie",
  "setCookie",
  "setHeader",
  "setHeaders",
  "setResponseHeader",
  "setResponseHeaders",
  "setResponseStatus",
  "setServerTiming",
  "toEventHandler",
  "toMiddleware",
  "toNodeHandler",
  "toNodeListener",
  "toRequest",
  "toResponse",
  "toWebHandler",
  "unsealSession",
  "updateSession",
  "useBase",
  "useSession",
  "withBase",
  "withCacheIsolation",
  "withServerTiming",
  "writeEarlyHints",
].sort();

// Nomes (valores e tipos) nas cláusulas `export { ... }` / `export type { ... }` de src/index.ts no commit base.
const BASE_INDEX_EXPORT_NAMES = [
  "BasicAuthOptions",
  "BuiltinRouteRules",
  "CacheConditions",
  "ComposedMiddleware",
  "CorsOptions",
  "DisposeCallback",
  "DynamicEventHandler",
  "ErrorBody",
  "ErrorDetails",
  "ErrorInput",
  "EventHandler",
  "EventHandlerFetch",
  "EventHandlerObject",
  "EventHandlerRequest",
  "EventHandlerResponse",
  "EventHandlerWithFetch",
  "EventStream",
  "EventStreamMessage",
  "EventStreamOptions",
  "FetchHandler",
  "FetchableObject",
  "H3",
  "H3Config",
  "H3Core",
  "H3CoreConfig",
  "H3Event",
  "H3EventContext",
  "H3Plugin",
  "H3Route",
  "H3RouteMeta",
  "HTTPError",
  "HTTPEvent",
  "HTTPHandler",
  "HTTPMethod",
  "HTTPResponse",
  "InferEventInput",
  "JsonRpcError",
  "JsonRpcMethod",
  "JsonRpcParams",
  "JsonRpcRequest",
  "JsonRpcResponse",
  "JsonRpcWebSocketMethod",
  "LazyEventHandler",
  "MatchedRoute",
  "Middleware",
  "MiddlewareOptions",
  "NodeHandler",
  "NodeMiddleware",
  "PreparedResponse",
  "ProxyOptions",
  "RawHTML",
  "ReadBodyOptions",
  "RequestFingerprintOptions",
  "ResolveDotSegmentsOptions",
  "ResolvedRouteRules",
  "RouteDefinition",
  "RouteOptions",
  "RouteRegistrar",
  "RouteRules",
  "RouterContext",
  "ServeStaticOptions",
  "Session",
  "SessionConfig",
  "SessionData",
  "SessionManager",
  "StaticAssetMeta",
  "TypedHeaders",
  "TypedServerRequest",
  "WebSocketHooks",
  "WebSocketMessage",
  "WebSocketPeer",
  "WebSocketResponse",
  "appendAcceptQuery",
  "appendCorsHeaders",
  "appendCorsPreflightHeaders",
  "assertBodySize",
  "assertMethod",
  "basicAuth",
  "bodyLimit",
  "callMiddleware",
  "clearSession",
  "composeMiddleware",
  "defineHandler",
  "defineJsonRpcHandler",
  "defineJsonRpcWebSocketHandler",
  "defineLazyEventHandler",
  "defineMiddleware",
  "defineNodeHandler",
  "defineNodeMiddleware",
  "definePlugin",
  "defineRoute",
  "defineValidatedHandler",
  "defineWebSocket",
  "defineWebSocketHandler",
  "deleteChunkedCookie",
  "deleteCookie",
  "dynamicEventHandler",
  "fetchWithEvent",
  "fromNodeHandler",
  "fromWebHandler",
  "getChunkedCookie",
  "getCookie",
  "getEventContext",
  "getProxyRequestHeaders",
  "getQuery",
  "getRequestFingerprint",
  "getRequestHost",
  "getRequestIP",
  "getRequestProtocol",
  "getRequestURL",
  "getRouterParam",
  "getRouterParams",
  "getSession",
  "getValidatedCookies",
  "getValidatedQuery",
  "getValidatedRouterParams",
  "handleCacheHeaders",
  "handleCors",
  "html",
  "isCanonicalPath",
  "isCorsOriginAllowed",
  "isEvent",
  "isHTTPEvent",
  "isMethod",
  "isPreflightRequest",
  "iterable",
  "mockEvent",
  "noContent",
  "normalizeRoute",
  "onDispose",
  "onError",
  "onRequest",
  "onResponse",
  "parseCookies",
  "proxy",
  "proxyRequest",
  "raw",
  "readBody",
  "readValidatedBody",
  "redirect",
  "redirectBack",
  "removeRoute",
  "requestWithBaseURL",
  "requestWithURL",
  "requireBasicAuth",
  "requireContentType",
  "resolveDotSegments",
  "sanitizeStatusCode",
  "sanitizeStatusMessage",
  "sealSession",
  "serveStatic",
  "setChunkedCookie",
  "setCookie",
  "setServerTiming",
  "toEventHandler",
  "toMiddleware",
  "toRequest",
  "toResponse",
  "toWebHandler",
  "unsealSession",
  "updateSession",
  "useSession",
  "withBase",
  "withCacheIsolation",
  "withServerTiming",
  "writeEarlyHints",
].sort();

/** Nomes (inclusive tipos) que aparecem em cláusulas `export { ... }` / `export type { ... }`. */
function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const [, list = ""] of source.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of list.split(",")) {
      const spec = raw
        .replace(/\/\/.*$/gm, "")
        .trim()
        .replace(/^type\s+/, "");
      if (!spec) continue;
      const parts = spec.split(/\s+as\s+/);
      names.add(parts[parts.length - 1]!.trim());
    }
  }
  return [...names].sort();
}

describe("serve static range (#1267) public API", () => {
  it("R13: nenhuma exportação pública nova", () => {
    // Exportações de valor do pacote: iguais às do commit base.
    expect(Object.keys(h3).sort()).toEqual(BASE_RUNTIME_EXPORTS);

    // Exportações nomeadas de src/index.ts (inclusive `export type`): iguais às do commit base.
    const indexSource = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(exportedNames(indexSource)).toEqual(BASE_INDEX_EXPORT_NAMES);

    // Nenhuma outra forma de exportação nova: no commit base a única é `export * from "./_deprecated.ts"`.
    const otherExports = indexSource
      .split(/\r?\n/)
      .filter((line) => /^\s*export\b/.test(line) && !/^\s*export\s+(?:type\s+)?\{/.test(line))
      .map((line) => line.trim());
    expect(otherExports).toEqual(['export * from "./_deprecated.ts";']);

    // Os helpers de Range ficam privados no módulo: utils/static só exporta serveStatic em runtime.
    expect(Object.keys(staticModule)).toEqual(["serveStatic"]);
  });
});
