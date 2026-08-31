import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, beforeEach } from "node:test";

process.env.ODW_STORAGE = "memory";
process.env.ODW_SESSION_SECRET = "a".repeat(48);
process.env.ODW_GAME_INTERNAL_TOKEN = "whatever-the-game-server-holds";

const { buildApp } = await import("../src/app.js");
const { GameServerError } = await import("../src/game.js");
const storage = await import("../src/storage/index.js");

/**
 * The two things outside this process, stood in for.
 *
 * What is being tested is this application's half of signing up: that an
 * address nobody has proved gets no game account, and that a confirmed one
 * gets exactly one. Standing up a game server and an SMTP server to show that
 * would be testing somebody else's software.
 */
const fakeGame = {
  registrations: [],
  failWith: null,
  /*
   * Names are the game server's to rule on — shape and uniqueness both — so the
   * double answers the way it does: free unless somebody already registered it.
   */
  async checkName(name) {
    if (fakeGame.failWith) throw fakeGame.failWith;
    const wanted = String(name ?? "").trim();
    if (wanted.length < 3) return { name: wanted, free: false, reason: "bad_name", error: "a name is 3 to 16 characters" };
    const taken = fakeGame.registrations.some((one) => one.name?.toLowerCase() === wanted.toLowerCase());
    return { name: wanted, free: !taken, ...(taken ? { reason: "name_taken" } : {}) };
  },
  async registerAccount({ name } = {}) {
    if (fakeGame.failWith) throw fakeGame.failWith;
    /* The real server refuses a taken name with a 409 carrying a reason, and
       this test file turns on that refusal — so the double has to make it. */
    if (name && fakeGame.registrations.some((one) => one.name?.toLowerCase() === name.toLowerCase())) {
      throw new GameServerError(409, `${name} is already taken`);
    }
    const accountId = 1_000_000_001 + fakeGame.registrations.length;
    fakeGame.registrations.push({ accountId, name });
    return {
      accountId,
      name: name ?? "Hero",
      token: `${Math.floor(Date.now() / 1000) + 3600}:${"a".repeat(64)}`,
      expires: new Date(Date.now() + 3600_000).toISOString(),
    };
  },
  async reissueToken(accountId) {
    return { accountId, token: `${Math.floor(Date.now() / 1000) + 7200}:${"b".repeat(64)}`, expires: "later" };
  },
  revocations: [],
  async revokeTokens(accountId) {
    if (fakeGame.failWith) throw fakeGame.failWith;
    fakeGame.revocations.push(accountId);
    return { accountId, generation: fakeGame.revocations.length };
  },
};

const fakeMailer = {
  sent: [],
  async sendVerification(email, token) {
    fakeMailer.sent.push({ email, token, kind: "verify" });
  },
  async sendPasswordReset(email, token) {
    fakeMailer.sent.push({ email, token, kind: "reset" });
  },
};
const lastLink = () => fakeMailer.sent.at(-1);

const app = await buildApp({ game: fakeGame, mailer: fakeMailer, rateLimited: false });
await app.ready();

after(async () => {
  await app.close();
  await storage.close();
});

beforeEach(async () => {
  fakeGame.registrations.length = 0;
  fakeGame.revocations.length = 0;
  fakeGame.failWith = null;
  fakeMailer.sent.length = 0;
  await storage.close();
});

/** One browser: it keeps its cookies and fetches a CSRF token when it needs one. */
const browser = () => {
  const jar = new Map();

  const send = async (method, url, body, headers = {}) => {
    const response = await app.inject({
      method,
      url,
      payload: body,
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
    });
    for (const cookie of response.cookies ?? []) {
      if (cookie.value === "") jar.delete(cookie.name);
      else jar.set(cookie.name, cookie.value);
    }
    return response;
  };

  const csrf = async () => (await send("GET", "/api/csrf")).json().csrfToken;

  return {
    send,
    get: (url) => send("GET", url),
    post: async (url, body) => send("POST", url, body, { "x-csrf-token": await csrf() }),
    delete: async (url) => send("DELETE", url, undefined, { "x-csrf-token": await csrf() }),
  };
};

const credentials = { email: "player@example.com", password: "a-long-enough-password", name: "Grimwald" };

/** Signed up and confirmed, for the tests whose subject is what comes after. */
const confirmed = async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const done = await visitor.post("/api/verify", { token: lastLink().token });
  return { visitor, ...done.json() };
};

test("registering creates a user and sends a link, and mints no game account", async () => {
  const response = await browser().post("/api/register", credentials);
  assert.equal(response.statusCode, 201);

  const body = response.json();
  assert.equal(body.user.email, credentials.email);
  assert.equal(body.user.verified, false);
  assert.equal(body.user.accountId, null);
  assert.equal(body.verificationRequired, true);

  assert.equal(lastLink().email, credentials.email);
  assert.equal(
    fakeGame.registrations.length,
    0,
    "an address nobody has proved must not get a game account"
  );
});

test("confirming creates the game account and hands over its token", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);

  const response = await visitor.post("/api/verify", { token: lastLink().token });
  assert.equal(response.statusCode, 200);

  const { user, game } = response.json();
  assert.equal(user.verified, true);
  assert.equal(user.accountId, game.accountId);
  assert.match(game.token, /^\d+:[0-9a-f]{64}$/);
  assert.equal(fakeGame.registrations.length, 1);
});

test("an unconfirmed user cannot get a game token", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);

  const refused = await visitor.post("/api/game-token");
  assert.equal(refused.statusCode, 409);
});

test("a link that was never issued is refused", async () => {
  await browser().post("/api/register", credentials);
  const response = await browser().post("/api/verify", { token: "not-a-real-token" });
  assert.equal(response.statusCode, 400);
  assert.equal(fakeGame.registrations.length, 0);
});

test("an expired link is refused", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const user = await storage.findUserByEmail(credentials.email);

  const stale = "a-token-that-has-run-out";
  await storage.createToken({
    userId: user.id,
    tokenHash: createHash("sha256").update(stale).digest("hex"),
    purpose: "verify",
    expires: new Date(Date.now() - 1000),
  });

  const response = await visitor.post("/api/verify", { token: stale });
  assert.equal(response.statusCode, 400);
  assert.equal(fakeGame.registrations.length, 0);
});

/**
 * Clicking twice is ordinary — mail clients prefetch, people double-click. The
 * second one must not mint a second account.
 */
test("a link used twice creates only one account", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const token = lastLink().token;

  const first = await visitor.post("/api/verify", { token });
  const second = await visitor.post("/api/verify", { token });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 400, "the token is spent");
  assert.equal(fakeGame.registrations.length, 1);
});

test("asking for another link retires the one before it", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const original = lastLink().token;

  await visitor.post("/api/verify/resend", { email: credentials.email });
  const replacement = lastLink().token;
  assert.notEqual(original, replacement);

  assert.equal((await visitor.post("/api/verify", { token: original })).statusCode, 400);
  assert.equal((await visitor.post("/api/verify", { token: replacement })).statusCode, 200);
});

/**
 * Told apart, this would be a way to ask which addresses have signed up here.
 */
test("a resend for an unknown address answers the same and sends nothing", async () => {
  const response = await browser().post("/api/verify/resend", { email: "nobody@example.com" });
  assert.equal(response.statusCode, 200);
  assert.equal(fakeMailer.sent.length, 0);
});

/**
 * Spending the token first would burn somebody's only link over a hiccup on
 * the far side. This way the cost of a failure is a row nobody holds a token
 * for, and the link still works.
 */
test("a game server that refuses leaves the link usable", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const token = lastLink().token;

  fakeGame.failWith = new GameServerError(503, "game server unreachable");
  assert.equal((await visitor.post("/api/verify", { token })).statusCode, 502);

  fakeGame.failWith = null;
  const retried = await visitor.post("/api/verify", { token });
  assert.equal(retried.statusCode, 200);
  assert.equal(fakeGame.registrations.length, 1);
});

test("a second sign-up with the same address is refused", async () => {
  await browser().post("/api/register", credentials);
  const again = await browser().post("/api/register", { ...credentials, password: "another-password" });
  assert.equal(again.statusCode, 409);
});

test("a short password is refused before anything is written", async () => {
  const response = await browser().post("/api/register", { email: "x@example.com", password: "short", name: "Sable" });
  assert.equal(response.statusCode, 400);
  assert.equal(fakeMailer.sent.length, 0);
});

test("signing in with the right password works, and the wrong one does not", async () => {
  await confirmed();

  assert.equal((await browser().post("/api/login", credentials)).statusCode, 200);
  assert.equal(
    (await browser().post("/api/login", { ...credentials, password: "not-the-password" })).statusCode,
    401
  );
});

test("an unknown address is refused in the same words as a wrong password", async () => {
  await confirmed();

  const unknown = await browser().post("/api/login", { email: "nobody@example.com", password: "whatever-long" });
  const wrong = await browser().post("/api/login", { ...credentials, password: "wrong-but-long" });

  assert.equal(unknown.statusCode, wrong.statusCode);
  assert.deepEqual(unknown.json(), wrong.json());
});

test("confirming signs you in, wherever the link was opened", async () => {
  const { visitor } = await confirmed();
  const me = await visitor.get("/api/me");

  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.verified, true);
});

test("signing out ends the session", async () => {
  const { visitor } = await confirmed();
  await visitor.post("/api/logout");
  assert.equal((await visitor.get("/api/me")).statusCode, 401);
});

test("a state-changing call without a CSRF token is refused", async () => {
  const visitor = browser();
  await visitor.get("/api/csrf");
  const response = await visitor.send("POST", "/api/register", credentials);

  assert.equal(response.statusCode, 403);
  assert.equal(fakeMailer.sent.length, 0);
});

test("asking who you are without signing in is refused", async () => {
  assert.equal((await browser().get("/api/me")).statusCode, 401);
});

test("a confirmed account can replace and revoke its game token", async () => {
  const { visitor, game } = await confirmed();

  const reissued = await visitor.post("/api/game-token");
  assert.equal(reissued.statusCode, 200);
  assert.match(reissued.json().token, /^\d+:[0-9a-f]{64}$/);

  const revoked = await visitor.delete("/api/game-token");
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().accountId, game.accountId);
});

const newPassword = "a-brand-new-long-password";

test("asking to reset sends a link, and an unknown address sends nothing", async () => {
  await confirmed();
  fakeMailer.sent.length = 0;

  await browser().post("/api/password/forgot", { email: credentials.email });
  assert.equal(fakeMailer.sent.length, 1);
  assert.equal(lastLink().kind, "reset");

  const unknown = await browser().post("/api/password/forgot", { email: "nobody@example.com" });
  assert.equal(unknown.statusCode, 200);
  assert.equal(fakeMailer.sent.length, 1, "nothing more was sent");
});

test("resetting replaces the password", async () => {
  await confirmed();
  await browser().post("/api/password/forgot", { email: credentials.email });

  const reset = await browser().post("/api/password/reset", {
    token: lastLink().token,
    password: newPassword,
  });
  assert.equal(reset.statusCode, 200);

  assert.equal((await browser().post("/api/login", credentials)).statusCode, 401);
  assert.equal(
    (await browser().post("/api/login", { ...credentials, password: newPassword })).statusCode,
    200
  );
});

/**
 * A reset is what somebody does when they think another person has been in
 * their account. Leaving that person's session alive would make it a gesture.
 */
test("resetting ends every session that was open", async () => {
  const { visitor } = await confirmed();
  assert.equal((await visitor.get("/api/me")).statusCode, 200);

  await browser().post("/api/password/forgot", { email: credentials.email });
  await browser().post("/api/password/reset", { token: lastLink().token, password: newPassword });

  assert.equal((await visitor.get("/api/me")).statusCode, 401);
});

/**
 * `/api/game-token` hands out a credential good for most of a year. Anybody
 * who reached the account could hold one, and it would outlive the password by
 * months if the reset did not revoke it.
 */
test("resetting revokes the game token and hands back a fresh one", async () => {
  const { game } = await confirmed();
  await browser().post("/api/password/forgot", { email: credentials.email });

  const reset = await browser().post("/api/password/reset", {
    token: lastLink().token,
    password: newPassword,
  });

  assert.deepEqual(fakeGame.revocations, [game.accountId]);
  assert.match(reset.json().game.token, /^\d+:[0-9a-f]{64}$/);
});

/**
 * Revoking goes first for this reason: a password that has moved on while the
 * old client token still plays is worse than a reset that did not happen.
 */
test("a reset that cannot reach the game server changes nothing", async () => {
  await confirmed();
  await browser().post("/api/password/forgot", { email: credentials.email });
  const token = lastLink().token;

  fakeGame.failWith = new GameServerError(503, "game server unreachable");
  const refused = await browser().post("/api/password/reset", { token, password: newPassword });
  assert.equal(refused.statusCode, 502);

  // The old password still works, and the link has not been spent.
  assert.equal((await browser().post("/api/login", credentials)).statusCode, 200);

  fakeGame.failWith = null;
  const retried = await browser().post("/api/password/reset", { token, password: newPassword });
  assert.equal(retried.statusCode, 200);
});

/** Purpose is checked on redemption, not only on lookup. */
test("a confirmation link cannot be spent on the password route", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);

  const response = await visitor.post("/api/password/reset", {
    token: lastLink().token,
    password: newPassword,
  });
  assert.equal(response.statusCode, 400);
});

test("changing a password needs the current one", async () => {
  const { visitor } = await confirmed();

  const wrong = await visitor.post("/api/password", {
    currentPassword: "not-the-password",
    newPassword,
  });
  assert.equal(wrong.statusCode, 401);

  const right = await visitor.post("/api/password", {
    currentPassword: credentials.password,
    newPassword,
  });
  assert.equal(right.statusCode, 200);
});

/**
 * Knowing the current password means nothing is claimed to be compromised, so
 * the game client is left alone — signing somebody out of the game for tidying
 * up their password would be a surprise.
 */
test("changing a password ends other sessions but not this one, and spares the game", async () => {
  const { visitor } = await confirmed();

  const elsewhere = browser();
  await elsewhere.post("/api/login", credentials);
  assert.equal((await elsewhere.get("/api/me")).statusCode, 200);

  await visitor.post("/api/password", { currentPassword: credentials.password, newPassword });

  assert.equal((await visitor.get("/api/me")).statusCode, 200, "the browser that did it stays");
  assert.equal((await elsewhere.get("/api/me")).statusCode, 401, "the other one does not");
  assert.deepEqual(fakeGame.revocations, [], "the game client is not touched");
});

/* ------------------------------------------------------------ character - */

/**
 * The character panel's data comes from the game server, whole.
 *
 * The title ladder, the level and the standings are all rules that server owns,
 * so this side asks rather than working any of them out again.
 */
test("the character summary is passed through", async () => {
  fakeGame.readSummary = async (accountId) => ({
    account_id: accountId,
    name: "Grimwald",
    trophies: 9,
    trophies_of: 12,
    title: { name: "Slayer", tier: "rare" },
    hero: { id: 101, name: "Berserker", icon: "avatar_berserker", level: 47 },
    heroes: 6,
    clears: 1204,
  });

  const { visitor } = await confirmed();
  const response = await visitor.get("/api/me/character");

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().title.name, "Slayer");
  assert.equal(response.json().hero.level, 47);
  assert.equal(response.json().clears, 1204);
});

/**
 * And it is asked about the right player.
 *
 * The guard reads `account_id`, which is the column, and the handler read
 * `accountId`, which is undefined on that same object. `Number(undefined)` is
 * NaN, the game server refused the path, and its refusal arrived here as
 * `reachable: false` — so the panel reported the game server as down while it
 * was answering everything else perfectly. The test above could not see it,
 * because the stand-in took whatever it was handed without looking at it.
 */
test("the character summary is asked for under the signed-in account", async () => {
  let askedFor = "never called";
  fakeGame.readSummary = async (accountId) => {
    askedFor = accountId;
    return { account_id: accountId, name: "Grimwald", heroes: 1, clears: 0 };
  };

  const { visitor } = await confirmed();
  const mine = (await visitor.get("/api/me")).json().user;
  const response = await visitor.get("/api/me/character");

  assert.equal(response.statusCode, 200);
  assert.ok(Number.isFinite(Number(askedFor)), `asked the game server for ${askedFor}`);
  assert.equal(Number(askedFor), Number(mine.accountId), "and for the wrong account");
});

/**
 * And a game server that is not answering leaves the panel quiet rather than
 * failing the page: somebody signed in while the game restarts should still
 * reach their account.
 */
test("a character panel survives the game server being down", async () => {
  fakeGame.readSummary = async () => {
    throw new GameServerError(502, "connect ECONNREFUSED");
  };

  const { visitor } = await confirmed();
  const response = await visitor.get("/api/me/character");

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { reachable: false });
});

/* ------------------------------------------------------------------ names - */

/**
 * A name is chosen at sign-up, not at confirmation.
 *
 * The link is opened from an email, quite possibly in a different browser to
 * the one that filled the form in — so the name has to travel on the user row
 * rather than in the session or the request that redeems the link.
 */
test("the name chosen at sign-up is the one the account gets", async () => {
  const visitor = browser();
  await visitor.post("/api/register", { ...credentials, name: "Sable" });
  await visitor.post("/api/verify", { token: fakeMailer.sent.at(-1).token });

  assert.equal(fakeGame.registrations.at(-1).name, "Sable");
});

test("a name somebody already has is refused at the form", async () => {
  const first = browser();
  await first.post("/api/register", { ...credentials, name: "Sable" });
  await first.post("/api/verify", { token: fakeMailer.sent.at(-1).token });

  const second = await browser().post("/api/register", {
    email: "other@example.com",
    password: "a-long-enough-password",
    name: "sable",
  });

  assert.equal(second.statusCode, 409);
  assert.equal(second.json().reason, "name_taken");
});

test("a name of the wrong shape is refused before an account exists", async () => {
  const response = await browser().post("/api/register", { ...credentials, name: "no" });

  assert.equal(response.statusCode, 409);
  assert.equal(response.json().reason, "bad_name");
  assert.equal(fakeGame.registrations.length, 0, "nothing was created");
});

/**
 * The gap the availability check cannot close.
 *
 * A name is free when it is asked for and somebody else takes it before the
 * address is confirmed. The game server refuses at that point — and the link
 * has to survive it, or the answer to "somebody took your name" would be
 * "and now you cannot sign up at all".
 */
test("a name taken in the meantime leaves the link usable", async () => {
  const visitor = browser();
  await visitor.post("/api/register", { ...credentials, name: "Sable" });
  const link = fakeMailer.sent.at(-1).token;

  // Somebody else gets there first.
  const quicker = browser();
  await quicker.post("/api/register", { email: "quick@example.com", password: "a-long-enough-password", name: "Mox" });
  await quicker.post("/api/verify", { token: fakeMailer.sent.at(-1).token });
  fakeGame.registrations.push({ accountId: 999, name: "Sable" });

  const collided = await visitor.post("/api/verify", { token: link });
  assert.equal(collided.statusCode, 409);
  assert.equal(collided.json().reason, "name");

  // The same link, with another name, still works.
  const second = await visitor.post("/api/verify", { token: link, name: "Ivory" });
  assert.equal(second.statusCode, 200);
  assert.equal(fakeGame.registrations.at(-1).name, "Ivory");
});
