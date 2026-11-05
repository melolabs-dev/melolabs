// Gabarito oculto #1050, variante (a): `password` aceita string ou lista de strings.
// A primeira senha da lista sela; todas abrem.
// Depende só da API pública (src/index.ts). Roda em test/ do repositório h3.
import type { H3Event, SessionConfig } from "../src/index.ts";
import { beforeEach, vi } from "vitest";
import { clearSession, getSession, updateSession, useSession } from "../src/index.ts";
import { describeMatrix } from "./_setup.ts";

const NAME = "h3-rot";
const P_NEW = "new-secret-new-secret-new-secret-new-secret-0001";
const P_OLD = "old-secret-old-secret-old-secret-old-secret-0002";
const P_OLDER = "older-secret-older-secret-older-secret-0003";
const P_OTHER = "other-secret-other-secret-other-secret-0004";

// Seal options of the pre-8192-iterations default (legacy sessions)
const LEGACY_SEAL: SessionConfig["seal"] = {
  ttl: 0,
  timestampSkewSec: 60,
  localtimeOffsetMsec: 0,
  encryption: { saltBits: 256, algorithm: "aes-256-cbc", iterations: 1, minPasswordlength: 32 },
  integrity: { saltBits: 256, algorithm: "sha256", iterations: 1, minPasswordlength: 32 },
};

let idCtr = 0;
const gen = (prefix: string) => () => `${prefix}-${++idCtr}`;

/** Config with a single sealing password and no extra unseal passwords. */
const single = (password: string, prefix: string): SessionConfig => ({
  name: NAME,
  password,
  generateId: gen(prefix),
});

/** Variant (a): first password seals, all of them unseal. */
const rotating = (primary: string, extras: string[], prefix = "rot"): SessionConfig =>
  ({
    name: NAME,
    password: [primary, ...extras],
    generateId: gen(prefix),
  }) as unknown as SessionConfig;

const read = (config: SessionConfig) => async (event: H3Event) => {
  const session = await getSession(event, config);
  return { id: session.id, data: session.data };
};

const write = (config: SessionConfig, data: Record<string, unknown>) => async (event: H3Event) => {
  const session = await useSession(event, config);
  await session.update(data);
  return { id: session.id, data: session.data };
};

const tryUse = (config: SessionConfig) => async (event: H3Event) => {
  try {
    const session = await useSession(event, config);
    return { ok: true, id: session.id };
  } catch (error) {
    return { ok: false, message: String((error as Error)?.message) };
  }
};

const sessionCookies = (res: Response) =>
  res.headers.getSetCookie().filter((c) => c.startsWith(`${NAME}=`) || c.startsWith(`${NAME}.`));

/** `Cookie` request header carrying the (possibly chunked) live session cookies of a response. */
const cookieHeader = (res: Response) =>
  sessionCookies(res)
    .filter((c) => !/max-age=0/i.test(c))
    .map((c) => c.split(";")[0])
    .join("; ");

/** Raw sealed value of a non-chunked session cookie. */
const sealedValue = (res: Response) => {
  const cookie = sessionCookies(res).find((c) => c.startsWith(`${NAME}=`))!;
  return decodeURIComponent(cookie.split(";")[0].slice(NAME.length + 1));
};

describeMatrix("session #1050-a (password list)", (t, { it, expect }) => {
  beforeEach(() => {
    t.app.get("/old/write", write(single(P_OLD, "old"), { user: "alice" }));
    t.app.get("/older/write", write(single(P_OLDER, "older"), { user: "bob" }));
    t.app.get("/other/write", write(single(P_OTHER, "other"), { user: "mallory" }));
    t.app.get("/new/write", write(single(P_NEW, "new"), { user: "carol" }));
    t.app.get("/old/write-big", write(single(P_OLD, "big"), { big: "x".repeat(5000) }));
    t.app.get(
      "/legacy-new/write",
      write({ ...single(P_NEW, "legacy-new"), seal: LEGACY_SEAL }, { user: "dave" }),
    );
    t.app.get(
      "/legacy-old/write",
      write({ ...single(P_OLD, "legacy-old"), seal: LEGACY_SEAL }, { user: "erin" }),
    );

    t.app.get("/new/read", read(single(P_NEW, "newonly")));
    t.app.get("/new/read-strict", read({ ...single(P_NEW, "strict"), legacySealFallback: false }));
    t.app.get("/old/read", read(single(P_OLD, "oldonly")));

    const rot = rotating(P_NEW, [P_OLD]);
    t.app.get("/rot/read", read(rot));
    t.app.get("/rot/use", async (event) => {
      const session = await useSession(event, rot);
      return { id: session.id, data: session.data };
    });
    t.app.get("/rot/update", async (event) => {
      const session = await updateSession(event, rot, { visits: 1 });
      return { id: session.id, data: session.data };
    });
    t.app.get("/rot/clear", async (event) => {
      await getSession(event, rot);
      await clearSession(event, rot);
      return { cleared: true };
    });
    t.app.get("/rot2/read", read(rotating(P_NEW, [P_OLD, P_OLDER], "rot2")));
  });

  it("S1: reads a session sealed with a previous password listed in `password`", async () => {
    const res1 = await t.fetch("/old/write");
    const { id } = await res1.json();

    const res2 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res1) } });
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ id, data: { user: "alice" } });
  });

  it("S2: new sessions are sealed with the first password of the list", async () => {
    const res1 = await t.fetch("/rot/use");
    const { id } = await res1.json();
    const cookie = cookieHeader(res1);
    expect(cookie).not.toBe("");

    // Opens with the first password alone...
    const res2 = await t.fetch("/new/read", { headers: { Cookie: cookie } });
    expect((await res2.json()).id).toBe(id);

    // ...and not with the other password alone
    const res3 = await t.fetch("/old/read", { headers: { Cookie: cookie } });
    expect((await res3.json()).id).not.toBe(id);
  });

  it("S3: reading a session opened with a previous password reseals it with the first password", async () => {
    const res1 = await t.fetch("/old/write");
    const { id } = await res1.json();

    // Read-only request: the session is proactively resealed in a Set-Cookie
    const res2 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res1) } });
    expect((await res2.json()).id).toBe(id);
    const resealed = cookieHeader(res2);
    expect(resealed).not.toBe("");

    const res3 = await t.fetch("/new/read", { headers: { Cookie: resealed } });
    expect(await res3.json()).toEqual({ id, data: { user: "alice" } });

    // A session already sealed with the first password is not resealed on read
    const res4 = await t.fetch("/new/write");
    const res5 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res4) } });
    expect((await res5.json()).data).toEqual({ user: "carol" });
    expect(sessionCookies(res5)).toHaveLength(0);
  });

  it("S4: a session sealed with a password outside the list is treated as a new session", async () => {
    // Positive control: a listed previous password is accepted
    const resOld = await t.fetch("/old/write");
    const { id: oldId } = await resOld.json();
    const resOk = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(resOld) } });
    expect((await resOk.json()).id).toBe(oldId);

    const res1 = await t.fetch("/other/write");
    const { id } = await res1.json();
    const cookie = cookieHeader(res1);

    const res2 = await t.fetch("/rot/read", { headers: { Cookie: cookie } });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.id).not.toBe(id);
    expect(body2.data).toEqual({});

    const res3 = await t.fetch("/rot/use", { headers: { Cookie: cookie } });
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3.id).not.toBe(id);
    expect(body3.data).toEqual({});
  });

  it("S5: an empty list or a too short password fails with a clear error", async () => {
    t.app.get("/s5/valid", tryUse(rotating(P_NEW, [P_OLD], "s5")));
    t.app.get("/s5/empty", tryUse({ name: NAME, password: [] } as unknown as SessionConfig));
    t.app.get("/s5/short-extra", tryUse(rotating(P_NEW, ["short"], "s5")));
    t.app.get("/s5/short-first", tryUse(rotating("short", [P_NEW], "s5")));
    t.app.get("/s5/short-string", tryUse(single("short", "s5")));

    const valid = await (await t.fetch("/s5/valid")).json();
    expect(valid.ok).toBe(true);

    for (const path of ["/s5/empty", "/s5/short-extra", "/s5/short-first", "/s5/short-string"]) {
      const body = await (await t.fetch(path)).json();
      expect(body.ok, path).toBe(false);
      expect(body.message, path).toMatch(/password/i);
    }
  });

  it("S6: a string or a single-item list keeps the current behavior", async () => {
    t.app.get("/s6/list-write", write(rotating(P_NEW, [], "s6"), { user: "frank" }));
    t.app.get("/s6/list-read", read(rotating(P_NEW, [], "s6")));

    // Single-item list seals with that password, readable by the plain string config
    const res1 = await t.fetch("/s6/list-write");
    const { id: listId } = await res1.json();
    const res2 = await t.fetch("/new/read", { headers: { Cookie: cookieHeader(res1) } });
    expect(await res2.json()).toEqual({ id: listId, data: { user: "frank" } });

    // ...and reads sessions sealed by the plain string config, without resealing
    const res3 = await t.fetch("/new/write");
    const { id: strId } = await res3.json();
    const res4 = await t.fetch("/s6/list-read", { headers: { Cookie: cookieHeader(res3) } });
    expect(await res4.json()).toEqual({ id: strId, data: { user: "carol" } });
    expect(sessionCookies(res4)).toHaveLength(0);

    // Neither form accepts a session sealed with another password
    const res5 = await t.fetch("/old/write");
    const { id: oldId } = await res5.json();
    const oldCookie = cookieHeader(res5);
    expect(
      (await (await t.fetch("/new/read", { headers: { Cookie: oldCookie } })).json()).id,
    ).not.toBe(oldId);
    expect(
      (await (await t.fetch("/s6/list-read", { headers: { Cookie: oldCookie } })).json()).id,
    ).not.toBe(oldId);
  });

  it("S7: tries the first password first, then the others in the given order", async () => {
    const deriveBits = vi.spyOn(crypto.subtle, "deriveBits");
    try {
      const count = async (path: string, cookie: string) => {
        deriveBits.mockClear();
        const res = await t.fetch(path, { headers: { Cookie: cookie } });
        const body = await res.json();
        return { calls: deriveBits.mock.calls.length, body };
      };

      // Sealed with the first password: no more work than a single-password config
      const resNew = await t.fetch("/new/write");
      const { id: newId } = await resNew.json();
      const baseline = await count("/new/read", cookieHeader(resNew));
      const rotated = await count("/rot2/read", cookieHeader(resNew));
      expect(baseline.body.id).toBe(newId);
      expect(rotated.body.id).toBe(newId);
      expect(rotated.calls).toBe(baseline.calls);

      // A later password in the list costs more attempts than an earlier one
      const resOld = await t.fetch("/old/write");
      const { id: oldId } = await resOld.json();
      const resOlder = await t.fetch("/older/write");
      const { id: olderId } = await resOlder.json();
      const viaOld = await count("/rot2/read", cookieHeader(resOld));
      const viaOlder = await count("/rot2/read", cookieHeader(resOlder));
      expect(viaOld.body.id).toBe(oldId);
      expect(viaOlder.body.id).toBe(olderId);
      expect(viaOld.calls).toBeGreaterThan(rotated.calls);
      expect(viaOlder.calls).toBeGreaterThan(viaOld.calls);
    } finally {
      deriveBits.mockRestore();
    }
  });

  it("S8: useSession, updateSession and clearSession work on a session opened with a previous password", async () => {
    const res1 = await t.fetch("/old/write");
    const { id } = await res1.json();
    const cookie = cookieHeader(res1);

    // useSession keeps the session
    const res2 = await t.fetch("/rot/use", { headers: { Cookie: cookie } });
    expect(await res2.json()).toEqual({ id, data: { user: "alice" } });

    // updateSession merges and persists, sealed with the first password
    const res3 = await t.fetch("/rot/update", { headers: { Cookie: cookie } });
    expect(await res3.json()).toEqual({ id, data: { user: "alice", visits: 1 } });
    const res4 = await t.fetch("/new/read", { headers: { Cookie: cookieHeader(res3) } });
    expect(await res4.json()).toEqual({ id, data: { user: "alice", visits: 1 } });

    // clearSession deletes the cookie
    const res5 = await t.fetch("/rot/clear", { headers: { Cookie: cookie } });
    expect(await res5.json()).toEqual({ cleared: true });
    const cleared = sessionCookies(res5).filter((c) => c.startsWith(`${NAME}=`));
    expect(cleared.length).toBeGreaterThanOrEqual(1);
    for (const c of cleared) {
      expect(c).toMatch(/max-age=0/i);
    }
  });

  it("S9: chunked cookie sessions and header sessions sealed with a previous password are accepted", async () => {
    // Chunked cookie
    const res1 = await t.fetch("/old/write-big");
    const { id: bigId } = await res1.json();
    expect(sessionCookies(res1).length).toBeGreaterThan(1);
    const res2 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res1) } });
    const body2 = await res2.json();
    expect(body2.id).toBe(bigId);
    expect(body2.data.big).toBe("x".repeat(5000));

    // Session header
    const res3 = await t.fetch("/old/write");
    const { id } = await res3.json();
    const res4 = await t.fetch("/rot/read", {
      headers: { [`x-${NAME}-session`]: sealedValue(res3) },
    });
    expect(await res4.json()).toEqual({ id, data: { user: "alice" } });
  });

  it("S10: legacy sessions (1 PBKDF2 iteration) keep working through the legacy fallback", async () => {
    // Legacy seal with the first password
    const res1 = await t.fetch("/legacy-new/write");
    const { id: id1 } = await res1.json();
    const res2 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res1) } });
    expect(await res2.json()).toEqual({ id: id1, data: { user: "dave" } });
    // Resealed with current options and the first password
    const res3 = await t.fetch("/new/read-strict", { headers: { Cookie: cookieHeader(res2) } });
    expect(await res3.json()).toEqual({ id: id1, data: { user: "dave" } });

    // Legacy seal with a previous password
    const res4 = await t.fetch("/legacy-old/write");
    const { id: id2 } = await res4.json();
    const res5 = await t.fetch("/rot/read", { headers: { Cookie: cookieHeader(res4) } });
    expect(await res5.json()).toEqual({ id: id2, data: { user: "erin" } });
    const res6 = await t.fetch("/new/read-strict", { headers: { Cookie: cookieHeader(res5) } });
    expect(await res6.json()).toEqual({ id: id2, data: { user: "erin" } });
  });
});
