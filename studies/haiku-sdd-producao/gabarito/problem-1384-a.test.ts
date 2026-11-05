// Gabarito oculto #1384, variante A (opt-in por configuracao: `problemDetails` no config do H3).
// Norma: RFC 9457. Depende apenas do contrato publico da variante A.
import { appendFileSync } from "node:fs";
import { vi } from "vitest";
import { HTTPError, type H3Event } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const PROBLEM = "application/problem+json";

function mediaType(res: Response): string | undefined {
  return res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
}

function membersContaining(body: unknown, marker: string): string[] {
  if (!body || typeof body !== "object") return [];
  return Object.entries(body as Record<string, unknown>)
    .filter(([, value]) => JSON.stringify(value ?? null).includes(marker))
    .map(([key]) => key);
}

function recordObservation(id: string, observation: unknown): void {
  const line = JSON.stringify({ id, observation });
  console.log(`[gabarito] ${line}`);
  const out = process.env.H3_GABARITO_OBS_FILE;
  if (out) appendFileSync(out, line + "\n");
}

describeMatrix("#1384-A problem details (opt-in)", (t, { it, expect }) => {
  (globalThis.console.error as any) = vi.fn();

  const enable = () => {
    t.app.config.problemDetails = true;
  };

  it("P1 rota inexistente responde 404 em problem+json com status, title e type", async () => {
    enable();
    const res = await t.fetch("/missing");
    expect(res.status).toBe(404);
    expect(mediaType(res)).toBe(PROBLEM);
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
    expect(typeof body.type).toBe("string");
  });

  it("P2 HTTPError 422 vira status, title (statusText) e detail (message)", async () => {
    enable();
    t.app.get("/p2", () => {
      throw new HTTPError({
        status: 422,
        statusText: "Unprocessable",
        message: "Name is required",
        data: { field: "name" },
      });
    });
    const res = await t.fetch("/p2");
    expect(res.status).toBe(422);
    expect(mediaType(res)).toBe(PROBLEM);
    const body = await res.json();
    expect(body).toMatchObject({
      status: 422,
      title: "Unprocessable",
      detail: "Name is required",
    });
  });

  it("P3 type ausente vira about:blank e type definido e respeitado", async () => {
    enable();
    t.app.get("/p3-default", () => {
      throw new HTTPError({ status: 400, statusText: "Bad Request" });
    });
    t.app.get("/p3-typed", () => {
      throw new HTTPError({
        status: 403,
        statusText: "Forbidden",
        type: "https://example.com/probs/out-of-credit",
      });
    });

    const resDefault = await t.fetch("/p3-default");
    expect(mediaType(resDefault)).toBe(PROBLEM);
    expect((await resDefault.json()).type).toBe("about:blank");

    const resTyped = await t.fetch("/p3-typed");
    expect(mediaType(resTyped)).toBe(PROBLEM);
    expect((await resTyped.json()).type).toBe("https://example.com/probs/out-of-credit");
  });

  it("P4 instance definido pelo app aparece no corpo", async () => {
    enable();
    t.app.get("/p4", () => {
      throw new HTTPError({
        status: 403,
        statusText: "Forbidden",
        instance: "/account/12345/msgs/abc",
      });
    });
    const res = await t.fetch("/p4");
    expect(res.status).toBe(403);
    expect(mediaType(res)).toBe(PROBLEM);
    expect((await res.json()).instance).toBe("/account/12345/msgs/abc");
  });

  it("P5 data vira membros de extensao sem sobrescrever os membros padrao", async () => {
    enable();
    t.app.get("/p5", () => {
      throw new HTTPError({
        status: 400,
        statusText: "Bad Request",
        message: "Invalid signup",
        type: "https://example.com/probs/validation",
        instance: "/signup/42",
        data: {
          field: "email",
          balance: 30,
          type: "x-data-type",
          title: "x-data-title",
          status: 999,
          detail: "x-data-detail",
          instance: "x-data-instance",
        },
      });
    });
    const res = await t.fetch("/p5");
    expect(res.status).toBe(400);
    expect(mediaType(res)).toBe(PROBLEM);
    const body = await res.json();
    expect(body.field).toBe("email");
    expect(body.balance).toBe(30);
    expect(body.type).toBe("https://example.com/probs/validation");
    expect(body.title).toBe("Bad Request");
    expect(body.status).toBe(400);
    expect(body.detail).toBe("Invalid signup");
    expect(body.instance).toBe("/signup/42");
  });

  it("P6 status do corpo e sempre igual ao status HTTP", async () => {
    enable();
    t.app.get("/p6-404", () => {
      throw new HTTPError({ status: 404 });
    });
    t.app.get("/p6-503", () => {
      throw new HTTPError({ status: 503, statusText: "Maintenance" });
    });
    t.app.get("/p6-number", () => {
      throw 418;
    });
    t.app.get("/p6-unhandled", () => {
      throw new Error("internal failure");
    });

    for (const [path, status] of [
      ["/p6-404", 404],
      ["/p6-503", 503],
      ["/p6-number", 418],
      ["/p6-unhandled", 500],
    ] as const) {
      const res = await t.fetch(path);
      expect(res.status).toBe(status);
      expect(mediaType(res)).toBe(PROBLEM);
      expect((await res.json()).status).toBe(status);
    }
    t.errors = [];
  });

  it("P7 cabecalhos de erro (errHeaders, headers do erro, set-cookie) sao preservados", async () => {
    enable();
    t.app.get("/p7", (event: H3Event) => {
      event.res.headers.set("x-success", "success");
      event.res.errHeaders.set("x-error", "prepared");
      event.res.errHeaders.append("set-cookie", "prepared=1");
      throw new HTTPError({
        status: 422,
        statusText: "Unprocessable",
        headers: { "x-error-own": "own", "set-cookie": "error=1" },
      });
    });

    for (const withOnError of [true, false]) {
      if (!withOnError) t.app.config.onError = undefined;
      const res = await t.fetch("/p7");
      expect(res.status).toBe(422);
      expect(mediaType(res)).toBe(PROBLEM);
      expect(res.headers.get("x-error")).toBe("prepared");
      expect(res.headers.get("x-error-own")).toBe("own");
      expect(res.headers.get("x-success")).toBeNull();
      expect(res.headers.getSetCookie().toSorted()).toEqual(["error=1", "prepared=1"]);
    }
  });

  it("P8 HEAD responde sem corpo e sem content-length", async () => {
    enable();
    t.app.get("/p8", () => {
      throw new HTTPError({ status: 422, statusText: "Unprocessable" });
    });

    for (const withOnError of [true, false]) {
      if (!withOnError) t.app.config.onError = undefined;
      for (const [path, status] of [
        ["/p8", 422],
        ["/missing", 404],
      ] as const) {
        const res = await t.fetch(path, { method: "HEAD" });
        expect(res.status).toBe(status);
        expect(mediaType(res)).toBe(PROBLEM);
        expect(res.headers.get("content-length")).toBeNull();
        expect(await res.text()).toBe("");
      }
    }
  });

  it("P9 com a opcao ausente ou desligada o formato atual fica intacto", async () => {
    t.app.get("/p9", () => {
      throw new HTTPError({
        status: 422,
        statusText: "Unprocessable",
        message: "Name is required",
        data: { field: "name" },
      });
    });
    const legacy = {
      status: 422,
      statusText: "Unprocessable",
      message: "Name is required",
      data: { field: "name" },
    };

    // Opcao ausente
    const resUnset = await t.fetch("/p9");
    expect(resUnset.headers.get("content-type")).toBe("application/json;charset=UTF-8");
    expect(await resUnset.json()).toMatchObject(legacy);

    // Opcao ligada (a opcao precisa existir e funcionar)
    t.app.config.problemDetails = true;
    const resOn = await t.fetch("/p9");
    expect(mediaType(resOn)).toBe(PROBLEM);
    await resOn.text();

    // Opcao desligada explicitamente
    t.app.config.problemDetails = false;
    const resOff = await t.fetch("/p9");
    expect(resOff.headers.get("content-type")).toBe("application/json;charset=UTF-8");
    expect(await resOff.json()).toMatchObject(legacy);
  });

  // P10 e OBSERVACAO, nao criterio de aceite: registra se o stack aparece no corpo e em qual membro.
  it("P10 (observacao) stack em modo debug", async ({ annotate }) => {
    enable();
    t.app.config.debug = true;
    function p10HandledSite(): never {
      throw new HTTPError({ status: 409, statusText: "Conflict", message: "p10 handled" });
    }
    function p10UnhandledSite(): never {
      throw new Error("p10 unhandled");
    }
    t.app.get("/p10-handled", () => p10HandledSite());
    t.app.get("/p10-unhandled", () => p10UnhandledSite());

    const observations = [];
    for (const [path, marker] of [
      ["/p10-handled", "p10HandledSite"],
      ["/p10-unhandled", "p10UnhandledSite"],
    ] as const) {
      const res = await t.fetch(path);
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = undefined;
      }
      observations.push({
        target: t.target,
        path,
        status: res.status,
        contentType: res.headers.get("content-type"),
        stackInBody: text.includes(marker),
        stackMembers: membersContaining(body, marker),
      });
    }
    t.errors = [];

    recordObservation("1384-A-P10", observations);
    await annotate(JSON.stringify(observations), "observation");
    expect(observations).toHaveLength(2);
  });
});
