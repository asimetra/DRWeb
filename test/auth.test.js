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
  async registerAccount({ name } = {}) {
    if (fakeGame.failWith) throw fakeGame.failWith;
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
  async revokeTokens(accountId) {
    return { accountId, generation: 1 };
  },
};

const fakeMailer = {
  sent: [],
  async sendVerification(email, token) {
    fakeMailer.sent.push({ email, token });
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

const credentials = { email: "player@example.com", password: "a-long-enough-password" };

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
  await storage.createVerification({
    userId: user.id,
    tokenHash: createHash("sha256").update(stale).digest("hex"),
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
  const response = await browser().post("/api/register", { email: "x@example.com", password: "short" });
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
