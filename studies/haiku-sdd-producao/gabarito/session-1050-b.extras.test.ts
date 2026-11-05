// Gabarito extra #1050, variante (b): campo novo `extraUnsealPasswords` (lista).
// Complementa session-1050-b.test.ts (aprovado, não alterado). Só OBSERVAÇÕES, nenhum critério
// de aceite: cada teste grava o que acontece (annotate, console.log e linha JSONL em
// H3_GABARITO_OBS_FILE) e o único expect confere que o registro foi feito.
// Depende só da API pública (src/index.ts). Os handlers capturam erros para que a observação
// rode também no commit base, onde `extraUnsealPasswords` não existe.
import { appendFileSync } from "node:fs";
import type { H3Event, SessionConfig } from "../src/index.ts";
import { beforeEach, vi } from "vitest";
import {
  getSession,
  sealSession,
  unsealSession,
  updateSession,
  useSession,
} from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const VARIANT = "b";
const NAME = "h3-rot";
const P_NEW = "new-secret-new-secret-new-secret-new-secret-0001";
const P_OLD = "old-secret-old-secret-old-secret-old-secret-0002";
const P_OLDER = "older-secret-older-secret-older-secret-0003";
const P_OTHER = "other-secret-other-secret-other-secret-0004";
const P_SHORT = "short";

const LABELS: Record<string, string> = {
  [P_NEW]: "new",
  [P_OLD]: "old",
  [P_OLDER]: "older",
  [P_OTHER]: "other",
  [P_SHORT]: "short",
};

let idCtr = 0;
const gen = (prefix: string) => () => `${prefix}-${++idCtr}`;

const single = (password: string, prefix: string): SessionConfig => ({
  name: NAME,
  password,
  generateId: gen(prefix),
});

/** Variant (b): `password` seals, `password` and `extraUnsealPasswords` unseal. */
const rotating = (primary: string, extras: string[], prefix = "rot"): SessionConfig =>
  ({
    name: NAME,
    password: primary,
    extraUnsealPasswords: extras,
    generateId: gen(prefix),
  }) as SessionConfig;

function recordObservation(id: string, observation: unknown): void {
  const line = JSON.stringify({ id, observation });
  console.log(`[gabarito] ${line}`);
  const out = process.env.H3_GABARITO_OBS_FILE;
  if (out) appendFileSync(out, line + "\n");
}

/** Handler que nunca lança: devolve `{ ok: false, message }` em vez de virar 500. */
const safe = (fn: (event: H3Event) => Promise<Record<string, unknown>>) => async (event: H3Event) => {
  try {
    return { ok: true, ...(await fn(event)) };
  } catch (error) {
    return { ok: false, message: String((error as Error)?.message) };
  }
};

const read = (config: SessionConfig) =>
  safe(async (event) => {
    const session = await getSession(event, config);
    return { id: session.id, data: session.data };
  });

const write = (config: SessionConfig, data: Record<string, unknown>) =>
  safe(async (event) => {
    const session = await useSession(event, config);
    await session.update(data);
    return { id: session.id, data: session.data };
  });

const sessionCookies = (res: Response) =>
  res.headers.getSetCookie().filter((c) => c.startsWith(`${NAME}=`) || c.startsWith(`${NAME}.`));

const cookieHeader = (res: Response) =>
  sessionCookies(res)
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(";")[0])
    .join("; ");

const sealedValue = (res: Response) => {
  const cookie = sessionCookies(res).find((c) => c.startsWith(`${NAME}=`));
  return cookie ? decodeURIComponent(cookie.split(";")[0]!.slice(NAME.length + 1)) : "";
};

const json = async (res: Response): Promise<any> => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { unparsable: text.slice(0, 200) };
  }
};

describeMatrix("session #1050-b extras (observacoes)", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.get("/new/write", write(single(P_NEW, "new"), { user: "carol" }));
    t.app.get("/old/write", write(single(P_OLD, "old"), { user: "alice" }));
    t.app.get("/older/write", write(single(P_OLDER, "older"), { user: "bob" }));
    t.app.get("/other/write", write(single(P_OTHER, "other"), { user: "mallory" }));
    t.app.get("/new/read", read(single(P_NEW, "newonly")));

    const rot = rotating(P_NEW, [P_OLD]);
    t.app.get("/rot/read", read(rot));
    t.app.get("/rot/write", write(rot, { visits: 1 }));

    t.app.get("/rot3/read", read(rotating(P_NEW, [P_OLD, P_OLDER], "rot3")));
  });

  // O2 (S3): a re-selagem com `password` sai já na leitura ou só na próxima gravação?
  it("O2 (observacao) re-selagem de sessao aberta com senha antiga", async ({ annotate }) => {
    const res1 = await t.fetch("/old/write");
    const { id } = await json(res1);
    const oldCookie = cookieHeader(res1);

    // Só leitura, com a config que lista a senha antiga em extraUnsealPasswords.
    const resRead = await t.fetch("/rot/read", { headers: { Cookie: oldCookie } });
    const bodyRead = await json(resRead);
    const readCookie = cookieHeader(resRead);
    const readCookieOpensWithPrimary = readCookie
      ? (await json(await t.fetch("/new/read", { headers: { Cookie: readCookie } }))).id === id
      : null;

    // Gravação, partindo do cookie original (selado com a senha antiga).
    const resWrite = await t.fetch("/rot/write", { headers: { Cookie: oldCookie } });
    const bodyWrite = await json(resWrite);
    const writeCookie = cookieHeader(resWrite);
    const writeCookieOpensWithPrimary = writeCookie
      ? (await json(await t.fetch("/new/read", { headers: { Cookie: writeCookie } }))).id === id
      : null;

    const observation = {
      target: t.target,
      variant: VARIANT,
      read: {
        status: resRead.status,
        ok: bodyRead.ok,
        message: bodyRead.message,
        idPreserved: bodyRead.id === id,
        setCookieCount: sessionCookies(resRead).length,
        resealedOnRead: readCookie !== "",
        readCookieOpensWithPrimary,
      },
      write: {
        status: resWrite.status,
        ok: bodyWrite.ok,
        message: bodyWrite.message,
        idPreserved: bodyWrite.id === id,
        setCookieCount: sessionCookies(resWrite).length,
        writeCookieOpensWithPrimary,
      },
    };

    recordObservation(`1050-${VARIANT}-O2`, observation);
    await annotate(JSON.stringify(observation), "observation");
    expect(observation.target).toBe(t.target);
  });

  // O3 (S5): senha inválida (curta) misturada a senhas válidas. Erro ao selar, ao abrir, ou ignorada?
  it("O3 (observacao) senha extra curta no meio de extraUnsealPasswords", async ({ annotate }) => {
    // Senha extra curta entre duas extras válidas.
    const mixed = rotating(P_NEW, [P_OLD, P_SHORT, P_OLDER], "mixed");
    t.app.get(
      "/mixed/use",
      safe(async (event) => {
        const session = await useSession(event, mixed);
        return { id: session.id };
      }),
    );
    t.app.get(
      "/mixed/update",
      safe(async (event) => {
        const session = await updateSession(event, mixed, { visits: 1 });
        return { id: session.id };
      }),
    );
    t.app.get("/mixed/read", read(mixed));
    t.app.get(
      "/mixed/seal",
      safe(async (event) => ({ sealedLength: (await sealSession(event, mixed)).length })),
    );
    t.app.get(
      "/mixed/unseal",
      safe(async (event) => {
        const sealed = event.req.headers.get("x-sealed") || "";
        const unsealed = await unsealSession(event, mixed, sealed);
        return { id: unsealed.id };
      }),
    );

    const sealedBy: Record<string, { id: string; cookie: string; sealed: string }> = {};
    for (const who of ["new", "old", "older"] as const) {
      const res = await t.fetch(`/${who}/write`);
      sealedBy[who] = { id: (await json(res)).id, cookie: cookieHeader(res), sealed: sealedValue(res) };
    }

    const summarize = async (res: Response, expectedId?: string) => {
      const body = await json(res);
      return {
        status: res.status,
        ok: body.ok,
        message: body.message,
        ...(expectedId === undefined ? {} : { idPreserved: body.id === expectedId }),
        ...("sealedLength" in body ? { sealed: body.sealedLength > 0 } : {}),
        setCookieCount: sessionCookies(res).length,
      };
    };

    const observation = {
      target: t.target,
      variant: VARIANT,
      passwords: "password=new, extraUnsealPasswords=[old, short, older]",
      sealUseSessionNoCookie: await summarize(await t.fetch("/mixed/use")),
      sealUpdateSessionNoCookie: await summarize(await t.fetch("/mixed/update")),
      sealSessionDirect: await summarize(await t.fetch("/mixed/seal")),
      readNoCookie: await summarize(await t.fetch("/mixed/read")),
      openCookieNew: await summarize(
        await t.fetch("/mixed/read", { headers: { Cookie: sealedBy.new!.cookie } }),
        sealedBy.new!.id,
      ),
      openCookieOldBeforeShort: await summarize(
        await t.fetch("/mixed/read", { headers: { Cookie: sealedBy.old!.cookie } }),
        sealedBy.old!.id,
      ),
      openCookieOlderAfterShort: await summarize(
        await t.fetch("/mixed/read", { headers: { Cookie: sealedBy.older!.cookie } }),
        sealedBy.older!.id,
      ),
      unsealSessionNew: await summarize(
        await t.fetch("/mixed/unseal", { headers: { "x-sealed": sealedBy.new!.sealed } }),
        sealedBy.new!.id,
      ),
      unsealSessionOlderAfterShort: await summarize(
        await t.fetch("/mixed/unseal", { headers: { "x-sealed": sealedBy.older!.sealed } }),
        sealedBy.older!.id,
      ),
    };

    recordObservation(`1050-${VARIANT}-O3`, observation);
    await annotate(JSON.stringify(observation), "observation");
    expect(observation.target).toBe(t.target);
  });

  // O4 (S7): ordem em que as senhas são tentadas e se há derivações concorrentes.
  it("O4 (observacao) ordem e concorrencia das tentativas de senha", async ({ annotate }) => {
    const subtle = crypto.subtle;
    const originalImportKey = subtle.importKey.bind(subtle);
    const originalDeriveBits = subtle.deriveBits.bind(subtle);
    const keyLabels = new WeakMap<object, string>();
    let inFlight = 0;
    let maxInFlight = 0;
    let sequence: { password: string; iterations: number; concurrent: boolean }[] = [];

    const importKey = vi.spyOn(subtle, "importKey").mockImplementation((async (...args: any[]) => {
      const key = await (originalImportKey as any)(...args);
      const [format, keyData, algorithm] = args;
      const name = typeof algorithm === "string" ? algorithm : algorithm?.name;
      if (format === "raw" && name === "PBKDF2") {
        const text = new TextDecoder().decode(keyData as Uint8Array);
        keyLabels.set(key, LABELS[text] ?? `unknown(${text.length})`);
      }
      return key;
    }) as any);
    const deriveBits = vi.spyOn(subtle, "deriveBits").mockImplementation((async (
      ...args: any[]
    ) => {
      const [params, key] = args;
      sequence.push({
        password: keyLabels.get(key) ?? "?",
        iterations: params?.iterations,
        concurrent: inFlight > 0,
      });
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        return await (originalDeriveBits as any)(...args);
      } finally {
        inFlight--;
      }
    }) as any);

    try {
      const cookies: Record<string, { id: string; cookie: string }> = {};
      for (const who of ["new", "old", "older", "other"] as const) {
        const res = await t.fetch(`/${who}/write`);
        cookies[who] = { id: (await json(res)).id, cookie: cookieHeader(res) };
      }

      const measure = async (path: string, who: string) => {
        sequence = [];
        maxInFlight = 0;
        const res = await t.fetch(path, { headers: { Cookie: cookies[who]!.cookie } });
        const body = await json(res);
        return {
          path,
          sealedWith: who,
          status: res.status,
          ok: body.ok,
          idPreserved: body.id === cookies[who]!.id,
          resealed: cookieHeader(res) !== "",
          deriveBitsCalls: sequence.length,
          maxConcurrentDeriveBits: maxInFlight,
          // Na leitura com senha não principal, as últimas derivações podem ser da re-selagem.
          sequence: sequence.map(
            (s) => `${s.password}@${s.iterations}${s.concurrent ? "(concorrente)" : ""}`,
          ),
        };
      };

      const observation = {
        target: t.target,
        variant: VARIANT,
        passwords: "password=new, extraUnsealPasswords=[old, older]",
        cases: [
          await measure("/new/read", "new"),
          await measure("/rot3/read", "new"),
          await measure("/rot3/read", "old"),
          await measure("/rot3/read", "older"),
          await measure("/rot3/read", "other"),
        ],
      };

      recordObservation(`1050-${VARIANT}-O4`, observation);
      await annotate(JSON.stringify(observation), "observation");
      expect(observation.cases).toHaveLength(5);
    } finally {
      importKey.mockRestore();
      deriveBits.mockRestore();
    }
  });
});
