// Gabarito oculto #1384, variante C: testes NOVOS (P14, P15).
// Utilitario explicito `problem()` chamado pelo handler. Norma: RFC 9457.
// Depende apenas do contrato publico (enxuto) da variante C.
//   P14 (sim)  membro `detail` (RFC 9457 3.1.4): quando presente, e string.
//   P15 (obs.) como a implementacao preenche `detail` a partir da entrada de `problem()`: so registra.
import { appendFileSync } from "node:fs";
import { vi } from "vitest";
import { problem } from "../src/index.ts";
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

describeMatrix("#1384-C problem details (utilitario), testes novos", (t, { it, expect }) => {
  (globalThis.console.error as any) = vi.fn();

  it("P14 detail, quando presente, e string (RFC 9457 3.1.4)", async () => {
    t.app.get("/p14-message", () => {
      throw problem({ status: 422, statusText: "Unprocessable", message: "Name is required" });
    });
    t.app.get("/p14-no-message", () => {
      throw problem({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p14-status-only", () => {
      throw problem({ status: 404 });
    });
    t.app.get("/p14-default-status", () => {
      throw problem({ message: "No status given" });
    });
    t.app.get("/p14-returned", () => problem({ status: 410, message: "Resource is gone" }));

    const cases: Array<[string, number]> = [
      ["/p14-message", 422],
      ["/p14-no-message", 409],
      ["/p14-status-only", 404],
      ["/p14-default-status", 500],
      ["/p14-returned", 410],
    ];
    for (const [path, status] of cases) {
      const res = await t.fetch(path);
      expect(res.status).toBe(status);
      expect(mediaType(res)).toBe(PROBLEM);
      const body = await res.json();
      expect(body.status).toBe(status);
      if ("detail" in body) {
        expect(typeof body.detail).toBe("string");
      }
    }
  });

  // P15 e OBSERVACAO, nao criterio de aceite: a RFC 9457 nao fixa como `detail` e preenchido a
  // partir da entrada (message, statusText). So registra o que a implementacao faz.
  it("P15 (observacao) preenchimento de detail a partir da entrada de problem()", async ({
    annotate,
  }) => {
    t.app.get("/p15-message", () => {
      throw problem({ status: 422, statusText: "Unprocessable", message: "Name is required" });
    });
    t.app.get("/p15-no-message", () => {
      throw problem({ status: 409, statusText: "Conflict" });
    });
    t.app.get("/p15-status-only", () => {
      throw problem({ status: 404 });
    });
    t.app.get("/p15-default-status", () => {
      throw problem({ message: "No status given" });
    });

    const observations = [];
    for (const path of [
      "/p15-message",
      "/p15-no-message",
      "/p15-status-only",
      "/p15-default-status",
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
      });
    }

    recordObservation("1384-C-P15", observations);
    await annotate(JSON.stringify(observations), "observation");
    expect(observations).toHaveLength(4);
  });
});
