// Gabarito extra: h3js/h3#1267 (HTTP Range no serveStatic). Norma: RFC 9110 seções 13.1.5 e 14.
// Complementa range-1267.test.ts (aprovado, não alterado). Roda nos alvos "web" e "node".
// Como no aprovado, toda requisição manda `accept-encoding` explícito.
// E5 não estava na encomenda original: entrou porque a forma aberta `bytes=N-` com N além do
// tamanho revelou desvio da norma na referência.
// E1 e E3 são guardas: também passam numa base sem suporte a Range (ali o Range já é ignorado).
// O1 é OBSERVAÇÃO, não critério de aceite: só registra o que acontece.
import { appendFileSync } from "node:fs";
import { beforeEach } from "vitest";
import { serveStatic } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const identity = { "accept-encoding": "identity" };
const MTIME = 1_700_000_000_000;

function recordObservation(id: string, observation: unknown): void {
  const line = JSON.stringify({ id, observation });
  console.log(`[gabarito] ${line}`);
  const out = process.env.H3_GABARITO_OBS_FILE;
  if (out) appendFileSync(out, line + "\n");
}

describeMatrix("serve static range (#1267) extras", (t, { it, expect }) => {
  beforeEach(() => {
    // Entity-tag forte. "asset:/strong/test.png" tem 22 bytes.
    t.app.all("/strong/**", (event) =>
      serveStatic(event, {
        getContents: (id) => `asset:${id}`,
        getMeta: (id) => ({
          type: "text/plain",
          etag: '"abc"',
          mtime: MTIME,
          size: `asset:${id}`.length,
        }),
      }),
    );

    // Entity-tag fraco. "asset:/weak/test.png" tem 20 bytes.
    t.app.all("/weak/**", (event) =>
      serveStatic(event, {
        getContents: (id) => `asset:${id}`,
        getMeta: (id) => ({
          type: "text/plain",
          etag: 'W/"abc"',
          mtime: MTIME,
          size: `asset:${id}`.length,
        }),
      }),
    );

    // Asset vazio (size zero).
    t.app.all("/zero/**", (event) =>
      serveStatic(event, {
        getContents: () => "",
        getMeta: () => ({ type: "text/plain", etag: '"zero"', mtime: MTIME, size: 0 }),
      }),
    );

    // Asset de tamanho desconhecido (getMeta sem size).
    t.app.all("/nosize/**", (event) =>
      serveStatic(event, {
        getContents: (id) => `asset:${id}`,
        getMeta: () => ({ type: "text/plain", etag: '"nosize"', mtime: MTIME }),
      }),
    );
  });

  it("E1: If-Range com entity-tag fraco ignora o Range (comparação forte) e responde 200", async () => {
    // Asset com etag forte "abc", If-Range W/"abc": a comparação forte nunca casa um etag fraco.
    const vsStrong = await t.fetch("/strong/test.png", {
      headers: { ...identity, range: "bytes=0-4", "if-range": 'W/"abc"' },
    });
    expect(vsStrong.status).toBe(200);
    expect(await vsStrong.text()).toBe("asset:/strong/test.png");
    expect(vsStrong.headers.get("content-range")).toBeNull();

    // Asset com etag fraco W/"abc", If-Range idêntico W/"abc": fraco não serve para If-Range.
    const vsWeak = await t.fetch("/weak/test.png", {
      headers: { ...identity, range: "bytes=0-4", "if-range": 'W/"abc"' },
    });
    expect(vsWeak.status).toBe(200);
    expect(await vsWeak.text()).toBe("asset:/weak/test.png");
    expect(vsWeak.headers.get("content-range")).toBeNull();
  });

  it("E2: If-Range com HTTP-date igual ao last-modified aplica o Range; diferente, 200 completo", async () => {
    const lastModified = new Date(MTIME).toUTCString();

    const same = await t.fetch("/strong/test.png", {
      headers: { ...identity, range: "bytes=0-4", "if-range": lastModified },
    });
    expect(same.headers.get("last-modified")).toBe(lastModified);
    expect(same.status).toBe(206);
    expect(await same.text()).toBe("asset");
    expect(same.headers.get("content-range")).toBe("bytes 0-4/22");
    expect(same.headers.get("content-length")).toBe("5");

    for (const other of [
      new Date(MTIME + 60_000).toUTCString(),
      new Date(MTIME - 60_000).toUTCString(),
    ]) {
      const res = await t.fetch("/strong/test.png", {
        headers: { ...identity, range: "bytes=0-4", "if-range": other },
      });
      expect(res.status, other).toBe(200);
      expect(await res.text(), other).toBe("asset:/strong/test.png");
      expect(res.headers.get("content-range"), other).toBeNull();
    }
  });

  it("E3: asset com size zero ou desconhecido ignora o Range e responde 200 sem Content-Range", async () => {
    for (const range of ["bytes=0-4", "bytes=-3", "bytes=5-"]) {
      const zero = await t.fetch("/zero/empty.txt", { headers: { ...identity, range } });
      expect(zero.status, `zero ${range}`).toBe(200);
      expect(await zero.text(), `zero ${range}`).toBe("");
      expect(zero.headers.get("content-range"), `zero ${range}`).toBeNull();

      const noSize = await t.fetch("/nosize/test.png", { headers: { ...identity, range } });
      expect(noSize.status, `nosize ${range}`).toBe(200);
      expect(await noSize.text(), `nosize ${range}`).toBe("asset:/nosize/test.png");
      expect(noSize.headers.get("content-range"), `nosize ${range}`).toBeNull();
    }
    expect(t.errors).toEqual([]);
  });

  it("E4: Accept-Ranges: bytes também nas respostas 304 e 416", async () => {
    const notModified = await t.fetch("/strong/test.png", {
      headers: { ...identity, "if-none-match": '"abc"' },
    });
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get("accept-ranges")).toBe("bytes");

    const unsatisfiable = await t.fetch("/strong/test.png", {
      headers: { ...identity, range: "bytes=99-120" },
    });
    expect(unsatisfiable.status).toBe(416);
    expect(unsatisfiable.headers.get("accept-ranges")).toBe("bytes");
  });

  it("E5: Range aberto com início no tamanho ou além (bytes=N-) responde 416", async () => {
    // RFC 9110 14.1.1/14.1.2: first-pos >= tamanho torna o intervalo não satisfazível,
    // também na forma aberta, sem last-pos. "asset:/strong/test.png" tem 22 bytes.
    for (const range of ["bytes=22-", "bytes=99-"]) {
      const res = await t.fetch("/strong/test.png", { headers: { ...identity, range } });
      expect(res.status, range).toBe(416);
      expect(res.headers.get("content-range"), range).toBe("bytes */22");
      expect(await res.text(), range).toBe("");
    }
  });

  // O1 é OBSERVAÇÃO: R9 do aprovado exige 206 em HEAD com Range, mas a RFC 9110 (14.2) diz que
  // o servidor DEVE ignorar Range em métodos diferentes de GET. Aqui só se grava o que acontece.
  it("O1 (observacao) HEAD com Range", async ({ annotate }) => {
    const pick = (res: Response) => ({
      status: res.status,
      contentRange: res.headers.get("content-range"),
      contentLength: res.headers.get("content-length"),
      acceptRanges: res.headers.get("accept-ranges"),
      etag: res.headers.get("etag"),
      lastModified: res.headers.get("last-modified"),
    });
    const observations = [];
    for (const [label, method, range] of [
      ["HEAD com Range", "HEAD", "bytes=0-4"],
      ["HEAD sem Range", "HEAD", undefined],
      ["GET com Range", "GET", "bytes=0-4"],
    ] as const) {
      const res = await t.fetch("/strong/test.png", {
        method,
        headers: range ? { ...identity, range } : identity,
      });
      const body = await res.text();
      observations.push({ target: t.target, label, ...pick(res), bodyLength: body.length });
    }

    recordObservation("1267-O1", observations);
    await annotate(JSON.stringify(observations), "observation");
    expect(observations).toHaveLength(3);
  });
});
