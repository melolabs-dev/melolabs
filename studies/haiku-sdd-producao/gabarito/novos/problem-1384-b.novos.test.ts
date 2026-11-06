// Gabarito oculto #1384, variante B: testes NOVOS (P14, P15).
// Problem details e o formato padrao de todos os erros. Norma: RFC 9457.
// Depende apenas do contrato publico (enxuto) da variante B.
//   P14 (sim)  membro `detail` (RFC 9457 3.1.4): quando presente, e string.
//   P15 (obs.) como a implementacao preenche `detail` a partir de HTTPError: so registra.
import { appendFileSync } from "node:fs";
import { vi } from "vitest";
import { HTTPError, readBody } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const PROBLEM = "application/problem+json";

function mediaType(res: Response): string | undefined {
  return res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
}

function recordObservation(id: string, observation: unknown): void {
  const line = JSON.stringify({ id, observation });
  console.log(`[gabarito] ${line}`);
  const out = process.env.H3_GABARITO_OBS_FILE;
  if (out) appendFileSync(out, line + "\n");
}

const INVALID_JSON: RequestInit = {
  method: "POST",
  body: "{ not json",
  headers: { "content-type": "application/json" },
};

describeMatrix("#1384-B problem details (padrao), testes novos", (t, { it, expect }) => {
  (globalThis.console.error as any) = vi.fn();

  it("P14 detail, quando presente, e string (RFC 9457 3.1.4)", async () => {
    t.app.get("/p14-message", () => {
      throw new HTTPError({ status: 422, statusText: "Unprocessable", message: "Name is required" });
    });
    t.app.get("/p14-no-message", () => {
      throw new HTTPError({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p14-status", () => {
      throw HTTPError.status(403, "Forbidden");
    });
    t.app.get("/p14-number", () => {
      throw 418;
    });
    t.app.get("/p14-unhandled", () => {
      throw new Error("p14 internal failure");
    });
    t.app.post("/p14-body", async (event) => {
      await readBody(event);
      return "ok";
    });

    const cases: Array<[string, number, RequestInit?]> = [
      ["/p14-message", 422],
      ["/p14-no-message", 409],
      ["/p14-status", 403],
      ["/p14-number", 418],
      ["/p14-unhandled", 500],
      ["/missing", 404],
      ["/p14-body", 400, INVALID_JSON],
    ];
    for (const [path, status, init] of cases) {
      const res = await t.fetch(path, init);
      expect(res.status).toBe(status);
      expect(mediaType(res)).toBe(PROBLEM);
      const body = await res.json();
      expect(body.status).toBe(status);
      if ("detail" in body) {
        expect(typeof body.detail).toBe("string");
      }
    }
    t.errors = [];
  });

  // P15 e OBSERVACAO, nao criterio de aceite: a RFC 9457 nao fixa como `detail` e preenchido a
  // partir de HTTPError (message, statusText, erro nao tratado). So registra o que a implementacao faz.
  it("P15 (observacao) preenchimento de detail a partir de HTTPError", async ({ annotate }) => {
    // Sem debug, para que o stack (P10) nao se confunda com vazamento da mensagem interna.
    t.app.config.debug = false;
    t.app.get("/p15-message", () => {
      throw new HTTPError({ status: 422, statusText: "Unprocessable", message: "Name is required" });
    });
    t.app.get("/p15-no-message", () => {
      throw new HTTPError({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p15-message-ctor", () => {
      throw new HTTPError("Something is wrong", { status: 410 });
    });
    t.app.get("/p15-unhandled", () => {
      throw new Error("p15 internal failure");
    });

    const observations = [];
    for (const path of [
      "/p15-message",
      "/p15-no-message",
      "/p15-message-ctor",
      "/p15-unhandled",
      "/missing",
    ]) {
      const res = await t.fetch(path);
      const text = await res.text();
      let body: Record<string, unknown> | undefined;
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
        hasDetail: !!body && "detail" in body,
        detail: body?.detail ?? null,
        internalMessageInBody: text.includes("p15 internal failure"),
      });
    }
    t.errors = [];

    recordObservation("1384-B-P15", observations);
    await annotate(JSON.stringify(observations), "observation");
    expect(observations).toHaveLength(5);
  });
});
