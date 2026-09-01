import assert from "node:assert/strict";
import test, { after } from "node:test";

process.env.ODW_STORAGE = "memory";
process.env.ODW_SESSION_SECRET = "p".repeat(48);
process.env.ODW_GAME_INTERNAL_TOKEN = "whatever-the-game-server-holds";
process.env.ODW_GAME_ADDRESS = "http://dungeon.example:8080";

const { buildApp } = await import("../src/app.js");
const storage = await import("../src/storage/index.js");

const app = await buildApp({ game: {}, mailer: {}, rateLimited: false });
await app.ready();

after(async () => {
  delete process.env.ODW_GAME_ADDRESS;
  await app.close();
  await storage.close();
});

/**
 * A server people are being invited to play on has to say what it is and how
 * to reach it before it asks anybody for an address and a password.
 */
test("the address a player needs is readable without an account", async () => {
  const response = await app.inject({ method: "GET", url: "/api/server" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().gameAddress, "http://dungeon.example:8080");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.match(response.headers["content-security-policy"], /default-src 'self'/);
  assert.equal(response.headers["referrer-policy"], "no-referrer");
});

test("reading it starts no session", async () => {
  const response = await app.inject({ method: "GET", url: "/api/server" });
  assert.equal(response.cookies.length, 0);
});

/** The private address this application talks to is not the public one. */
test("the internal API address is not handed out", async () => {
  const body = (await app.inject({ method: "GET", url: "/api/server" })).body;
  assert.ok(!body.includes("8081"), body);
  assert.deepEqual(Object.keys(JSON.parse(body)), ["gameAddress"]);
});

test("the front page is not an API route and does not answer as one", async () => {
  // With no build present the SPA fallback is off, so this is a plain 404
  // rather than an accidental redirect into the login form.
  const response = await app.inject({ method: "GET", url: "/api/nonsense" });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "not found");
});

/* ---------------------------------------------------------- leaderboards - */

const { forgetBoards } = await import("../src/routes/public.js");
const { GameServerError } = await import("../src/game.js");

const asked = [];
const board = {
  metric: "clears",
  better: "higher",
  scope: null,
  entries: [{ rank: 1, account_id: 1000000001, name: "Kahraman", value: 12, at: "2026-08-31" }],
};

const boardApp = await buildApp({
  rateLimited: false,
  mailer: {},
  game: {
    async readBoard(metric, scope) {
      asked.push({ metric, scope });
      if (metric === "nonsense") throw new GameServerError(404, "no such board");
      if (metric === "broken") throw new GameServerError(503, "game server unreachable");
      return board;
    },
  },
});
await boardApp.ready();
after(() => boardApp.close());

/** A leaderboard nobody can read without an account is doing half its job. */
test("standings are readable without signing in", async () => {
  forgetBoards();
  const response = await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().entries[0].name, "Kahraman");
  assert.equal(response.cookies.length, 0, "and starts no session");
});

/**
 * This is the one route anybody on the internet can call without an account,
 * and every call behind it costs the game server a query.
 */
test("repeated reads do not go through to the game server every time", async () => {
  forgetBoards();
  asked.length = 0;
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears" });
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears" });
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears" });

  assert.equal(asked.length, 1);
});

test("a differently scoped board is its own question", async () => {
  forgetBoards();
  asked.length = 0;
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/speedrun?node=7&hero=101&party=2" });
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/speedrun?node=8&hero=101&party=2" });

  assert.equal(asked.length, 2);
  assert.deepEqual(asked[0].scope, { node: 7, hero: 101, party: 2, limit: 20 });
});

test("a limit nobody should be allowed to ask for is clamped", async () => {
  forgetBoards();
  asked.length = 0;
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears?limit=100000" });
  assert.equal(asked.at(-1).scope.limit, 100);

  forgetBoards();
  await boardApp.inject({ method: "GET", url: "/api/leaderboards/clears?limit=nonsense" });
  assert.equal(asked.at(-1).scope.limit, 20);
});

test("a board the game server does not have answers 404, not 503", async () => {
  forgetBoards();
  assert.equal(
    (await boardApp.inject({ method: "GET", url: "/api/leaderboards/nonsense" })).statusCode,
    404
  );
});

test("a game server that cannot be reached is not the caller's fault", async () => {
  forgetBoards();
  assert.equal(
    (await boardApp.inject({ method: "GET", url: "/api/leaderboards/broken" })).statusCode,
    503
  );
});

/* --------------------------------------------------------------- status - */

/**
 * The margin numbers, and what happens when the game is not answering.
 *
 * A front page that fails because the game server is restarting would be a site
 * that goes down whenever the thing it describes does. The boards live on this
 * side of the wall and have plenty to say without it, so the margin goes quiet
 * and the page stands.
 */
test("status passes the game server's counts through", async () => {
  const statusApp = await buildApp({
    game: {
      readStatus: async () => ({
        online: 7,
        in_dungeon: 4,
        runs_today: 318,
        uptime_seconds: 536_400,
      }),
    },
    mailer: {},
    rateLimited: false,
  });
  await statusApp.ready();

  const response = await statusApp.inject({ method: "GET", url: "/api/status" });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    online: 7,
    in_dungeon: 4,
    runs_today: 318,
    uptime_seconds: 536_400,
  });
  await statusApp.close();
});

test("a game server that is not answering leaves the page standing", async () => {
  const { GameServerError } = await import("../src/game.js");
  const downApp = await buildApp({
    game: {
      readStatus: async () => {
        throw new GameServerError(502, "connect ECONNREFUSED");
      },
    },
    mailer: {},
    rateLimited: false,
  });
  await downApp.ready();

  const response = await downApp.inject({ method: "GET", url: "/api/status" });

  assert.equal(response.statusCode, 200, "the site is up even when the game is not");
  assert.deepEqual(response.json(), { reachable: false });
  await downApp.close();
});
