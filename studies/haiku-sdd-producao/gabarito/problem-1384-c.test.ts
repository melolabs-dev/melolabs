// Gabarito oculto #1384, variante C (utilitario explicito `problem()` chamado pelo handler).
// Norma: RFC 9457. Depende apenas do contrato publico da variante C.
import { appendFileSync } from "node:fs";
import { vi } from "vitest";
import { HTTPError, problem, type H3Event } from "../src/index.ts";
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

describeMatrix("#1384-C problem details (utilitario)", (t, { it, expect }) => {
  (globalThis.console.error as any) = vi.fn();

  it("P1 erro 404 criado pelo utilitario responde em problem+json com status, title e type", async () => {
    t.app.get("/p1", () => {
      throw problem({ status: 404 });
    });
    const res = await t.fetch("/p1");
    expect(res.status).toBe(404);
    expect(mediaType(res)).toBe(PROBLEM);
    const body = await res.json();
    expect(body.status).toBe(404);
    expect(body.title).toBe("Not Found");
    expect(typeof body.type).toBe("string");
  });

  it("P2 erro 422 do utilitario vira status, title (statusText) e detail (message)", async () => {
    t.app.get("/p2", () => {
      throw problem({
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
    t.app.get("/p3-default", () => {
      throw problem({ status: 400, statusText: "Bad Request" });
    });
    t.app.get("/p3-typed", () => {
      throw problem({
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
    t.app.get("/p4", () => {
      throw problem({
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
    t.app.get("/p5", () => {
      throw problem({
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
    t.app.get("/p6-404", () => {
      throw problem({ status: 404 });
    });
    t.app.get("/p6-503", () => {
      throw problem({ status: 503, statusText: "Maintenance" });
    });
    t.app.get("/p6-default", () => {
      throw problem({ message: "No status given" });
    });
    t.app.get("/p6-returned", () => problem({ status: 409, statusText: "Conflict" }));

    for (const [path, status] of [
      ["/p6-404", 404],
      ["/p6-503", 503],
      ["/p6-default", 500],
      ["/p6-returned", 409],
    ] as const) {
      const res = await t.fetch(path);
      expect(res.status).toBe(status);
      expect(mediaType(res)).toBe(PROBLEM);
      expect((await res.json()).status).toBe(status);
    }
  });

  it("P7 cabecalhos de erro (errHeaders, headers do erro, set-cookie) sao preservados", async () => {
    t.app.get("/p7", (event: H3Event) => {
      event.res.headers.set("x-success", "success");
      event.res.errHeaders.set("x-error", "prepared");
      event.res.errHeaders.append("set-cookie", "prepared=1");
      throw problem({
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
    t.app.get("/p8", () => {
      throw problem({ status: 422, statusText: "Unprocessable" });
    });

    for (const withOnError of [true, false]) {
      if (!withOnError) t.app.config.onError = undefined;
      for (const [path, status] of [["/p8", 422]] as const) {
        const res = await t.fetch(path, { method: "HEAD" });
        expect(res.status).toBe(status);
        expect(mediaType(res)).toBe(PROBLEM);
        expect(res.headers.get("content-length")).toBeNull();
        expect(await res.text()).toBe("");
      }
    }
  });

  it("P9 sem chamar o utilitario o formato atual fica intacto", async () => {
    t.app.get("/p9-problem", () => {
      throw problem({ status: 400, statusText: "Bad Request" });
    });
    t.app.get("/p9", () => {
      throw new HTTPError({
        status: 422,
        statusText: "Unprocessable",
        message: "Name is required",
        data: { field: "name" },
      });
    });

    // O utilitario existe e funciona na mesma app
    const resProblem = await t.fetch("/p9-problem");
    expect(mediaType(resProblem)).toBe(PROBLEM);
    await resProblem.text();

    const res = await t.fetch("/p9");
    expect(res.status).toBe(422);
    expect(res.headers.get("content-type")).toBe("application/json;charset=UTF-8");
    expect(await res.json()).toMatchObject({
      status: 422,
      statusText: "Unprocessable",
      message: "Name is required",
      data: { field: "name" },
    });

    const resMissing = await t.fetch("/missing");
    expect(resMissing.status).toBe(404);
    expect(resMissing.headers.get("content-type")).toBe("application/json;charset=UTF-8");
    expect(await resMissing.json()).toMatchObject({ status: 404 });
  });

  // P10 e OBSERVACAO, nao criterio de aceite: registra se o stack aparece no corpo e em qual membro.
  it("P10 (observacao) stack em modo debug", async ({ annotate }) => {
    t.app.config.debug = true;
    function p10HandledSite(): never {
      throw problem({ status: 409, statusText: "Conflict", message: "p10 handled" });
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

    recordObservation("1384-C-P10", observations);
    await annotate(JSON.stringify(observations), "observation");
    expect(observations).toHaveLength(2);
  });

  it("P12 so as respostas que chamam o utilitario saem como problem+json", async () => {
    t.app.get("/p12-thrown", () => {
      throw problem({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p12-returned", () => problem({ status: 410, statusText: "Gone" }));
    t.app.get("/p12-async", async () => {
      await Promise.resolve();
      throw problem({ status: 429, statusText: "Too Many Requests" });
    });
    t.app.get("/p12-httperror", () => {
      throw new HTTPError({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p12-status", () => {
      throw HTTPError.status(403, "Forbidden");
    });
    t.app.get("/p12-number", () => {
      throw 401;
    });
    t.app.get("/p12-unhandled", () => {
      throw new TypeError("boom");
    });

    const cases: Array<[string, number, boolean]> = [
      ["/p12-thrown", 409, true],
      ["/p12-httperror", 409, false],
      ["/p12-returned", 410, true],
      ["/p12-status", 403, false],
      ["/p12-async", 429, true],
      ["/p12-number", 401, false],
      ["/p12-unhandled", 500, false],
      ["/missing", 404, false],
    ];
    for (const withOnError of [true, false]) {
      if (!withOnError) t.app.config.onError = undefined;
      for (const [path, status, isProblem] of cases) {
        const res = await t.fetch(path);
        expect(res.status).toBe(status);
        if (isProblem) {
          expect(mediaType(res)).toBe(PROBLEM);
        } else {
          expect(res.headers.get("content-type")).toBe("application/json;charset=UTF-8");
        }
        expect((await res.json()).status).toBe(status);
      }
    }
    t.errors = [];
  });
});
