import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

process.env.ODW_STORAGE = "memory";
process.env.ODW_SESSION_SECRET = "a".repeat(48);
process.env.ODW_GAME_INTERNAL_TOKEN = "whatever-the-game-server-holds";

const { buildApp } = await import("../src/app.js");
const { GameServerError } = await import("../src/game.js");
const storage = await import("../src/storage/index.js");

/**
 * The game server, stood in for.
 *
 * What is being tested here is this application's half of registering — that a
 * user row and a game account are created together or not at all, and that a
 * failure on the far side leaves nothing behind. Standing up a real server to
 * prove that would be testing the other repository.
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

const app = await buildApp({ game: fakeGame, rateLimited: false });
await app.ready();

after(async () => {
  await app.close();
  await storage.close();
});

beforeEach(async () => {
  fakeGame.registrations.length = 0;
  fakeGame.failWith = null;
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
    /** Every state-changing call carries a token, the way the front end will. */
    post: async (url, body) => send("POST", url, body, { "x-csrf-token": await csrf() }),
    delete: async (url) => send("DELETE", url, undefined, { "x-csrf-token": await csrf() }),
  };
};

const credentials = { email: "player@example.com", password: "a-long-enough-password" };

test("registering creates a user and a game account together", async () => {
  const response = await browser().post("/api/register", { ...credentials, name: "Kahraman" });
  assert.equal(response.statusCode, 201);

  const { user, game } = response.json();
  assert.equal(user.email, credentials.email);
  assert.equal(user.accountId, game.accountId);
  assert.match(game.token, /^\d+:[0-9a-f]{64}$/);
  assert.equal(fakeGame.registrations.at(-1).name, "Kahraman");
});

test("registering signs you in", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);

  const me = await visitor.get("/api/me");
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().user.email, credentials.email);
});

/**
 * The unique index is the only thing that can settle a race between two
 * sign-ups, which is why the user row is written before the account is minted.
 */
test("a second sign-up with the same address is refused and mints nothing", async () => {
  await browser().post("/api/register", credentials);
  const again = await browser().post("/api/register", { ...credentials, password: "another-password" });

  assert.equal(again.statusCode, 409);
  assert.equal(fakeGame.registrations.length, 1);
});

/**
 * The other order would leave a game account nobody can reach. This one leaves
 * a user row, which can be taken back out — and is.
 */
test("a game server that refuses leaves no half-made user behind", async () => {
  fakeGame.failWith = new GameServerError(503, "game server unreachable");

  const failed = await browser().post("/api/register", credentials);
  assert.equal(failed.statusCode, 502);
  assert.equal(await storage.findUserByEmail(credentials.email), null);

  // And the address is free again, which is the whole point of rolling back.
  fakeGame.failWith = null;
  const retried = await browser().post("/api/register", credentials);
  assert.equal(retried.statusCode, 201);
});

test("signing in with the right password works, and the wrong one does not", async () => {
  await browser().post("/api/register", credentials);

  const good = await browser().post("/api/login", credentials);
  assert.equal(good.statusCode, 200);

  const bad = await browser().post("/api/login", { ...credentials, password: "not-the-password" });
  assert.equal(bad.statusCode, 401);
});

/**
 * An unknown address and a wrong password answer alike, or this becomes a way
 * to ask whether somebody has an account here.
 */
test("an unknown address is refused in the same words as a wrong password", async () => {
  await browser().post("/api/register", credentials);

  const unknown = await browser().post("/api/login", { email: "nobody@example.com", password: "whatever-long" });
  const wrong = await browser().post("/api/login", { ...credentials, password: "wrong-but-long" });

  assert.equal(unknown.statusCode, wrong.statusCode);
  assert.deepEqual(unknown.json(), wrong.json());
});

test("a short password is refused before anything is written", async () => {
  const response = await browser().post("/api/register", { email: "x@example.com", password: "short" });
  assert.equal(response.statusCode, 400);
  assert.equal(fakeGame.registrations.length, 0);
});

test("signing out ends the session", async () => {
  const visitor = browser();
  await visitor.post("/api/register", credentials);
  assert.equal((await visitor.get("/api/me")).statusCode, 200);

  await visitor.post("/api/logout");
  assert.equal((await visitor.get("/api/me")).statusCode, 401);
});

test("a state-changing call without a CSRF token is refused", async () => {
  const visitor = browser();
  // A session exists — this is not "no cookie", it is "no token".
  await visitor.get("/api/csrf");
  const response = await visitor.send("POST", "/api/register", credentials);

  assert.equal(response.statusCode, 403);
  assert.equal(fakeGame.registrations.length, 0);
});

test("asking who you are without signing in is refused", async () => {
  assert.equal((await browser().get("/api/me")).statusCode, 401);
});

test("a replacement game token needs a session", async () => {
  assert.equal((await browser().post("/api/game-token")).statusCode, 401);

  const visitor = browser();
  await visitor.post("/api/register", credentials);
  const reissued = await visitor.post("/api/game-token");

  assert.equal(reissued.statusCode, 200);
  assert.match(reissued.json().token, /^\d+:[0-9a-f]{64}$/);
});

test("revoking the game tokens goes through to the game server", async () => {
  const visitor = browser();
  const { game } = (await visitor.post("/api/register", credentials)).json();

  const revoked = await visitor.delete("/api/game-token");
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json().accountId, game.accountId);
});
