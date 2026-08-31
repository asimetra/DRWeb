import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, beforeEach } from "node:test";
import { WebSocket } from "ws";

process.env.ODW_STORAGE = "memory";
process.env.ODW_SESSION_SECRET = "b".repeat(48);
process.env.ODW_GAME_INTERNAL_TOKEN = "whatever-the-game-server-holds";

const { buildApp } = await import("../src/app.js");
const { GameServerError } = await import("../src/game.js");
const storage = await import("../src/storage/index.js");

/**
 * The game server, stood in for.
 *
 * Settlement records the call rather than moving anything. What the goods do
 * once both sides agree is the other repository's problem and is tested there;
 * what this one has to get right is *which* call it makes, and when.
 */
const weapon = (id, extra = {}) => ({
  id,
  item_id: 11001,
  power: 5,
  avatar_id: null,
  avatar_slot: null,
  rarity: 1,
  requiredlevel: 1,
  ...extra,
});

const fakeGame = {
  accounts: new Map(),
  settlements: [],
  refuseWith: null,
  next: 1_000_000_001,

  async registerAccount() {
    const accountId = fakeGame.next++;
    fakeGame.accounts.set(accountId, {
      id: accountId,
      basic_currency: 1000,
      account_items: [],
    });
    return { accountId, token: `${Math.floor(Date.now() / 1000) + 3600}:${"a".repeat(64)}` };
  },
  async readAccount(accountId) {
    return fakeGame.accounts.get(Number(accountId));
  },
  async reissueToken(accountId) {
    return { accountId, token: "x" };
  },
  async revokeTokens(accountId) {
    return { accountId, generation: 1 };
  },
  async settleTrade(parties) {
    if (fakeGame.refuseWith) throw fakeGame.refuseWith;
    fakeGame.settlements.push(parties);
    return { parties };
  },
};

const fakeMailer = {
  sent: [],
  async sendVerification(email, token) {
    fakeMailer.sent.push({ email, token });
  },
  async sendPasswordReset(email, token) {
    fakeMailer.sent.push({ email, token });
  },
};

const app = await buildApp({ game: fakeGame, mailer: fakeMailer, rateLimited: false });
await app.listen({ host: "127.0.0.1", port: 0 });
const port = app.server.address().port;

after(async () => {
  await app.close();
  await storage.close();
});

beforeEach(async () => {
  fakeGame.accounts.clear();
  fakeGame.settlements.length = 0;
  fakeGame.refuseWith = null;
  fakeGame.next = 1_000_000_001;
  fakeMailer.sent.length = 0;
  await storage.close();
});

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
    jar,
    get: (url) => send("GET", url),
    post: async (url, body) => send("POST", url, body, { "x-csrf-token": await csrf() }),
    put: async (url, body) => send("PUT", url, body, { "x-csrf-token": await csrf() }),
    cookieHeader: () => [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
  };
};

/** A signed-in, confirmed player holding the weapons given. */
const player = async (email, items = []) => {
  const visitor = browser();
  await visitor.post("/api/register", { email, password: "a-long-enough-password" });
  const { game } = (await visitor.post("/api/verify", { token: fakeMailer.sent.at(-1).token })).json();
  fakeGame.accounts.get(game.accountId).account_items = items;
  return { visitor, accountId: game.accountId };
};

test("a pair gets one trade, however many times they ask", async () => {
  const one = await player("one@example.com");
  const two = await player("two@example.com");

  const first = await one.visitor.post("/api/trades", { partnerAccountId: two.accountId });
  assert.equal(first.statusCode, 201);

  const again = await one.visitor.post("/api/trades", { partnerAccountId: two.accountId });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().id, first.json().id);

  // And the other side is looking at the same one, not a second window.
  const theirs = await two.visitor.post("/api/trades", { partnerAccountId: one.accountId });
  assert.equal(theirs.json().id, first.json().id);
});

test("you cannot offer a weapon you do not have, or one you are wearing", async () => {
  const one = await player("one@example.com", [weapon(501), weapon(502, { avatar_id: 9 })]);
  const two = await player("two@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  assert.equal((await one.visitor.put(`/api/trades/${id}/offer`, { items: [999], gold: 0 })).statusCode, 409);
  assert.equal((await one.visitor.put(`/api/trades/${id}/offer`, { items: [502], gold: 0 })).statusCode, 409);
  assert.equal((await one.visitor.put(`/api/trades/${id}/offer`, { items: [501], gold: 0 })).statusCode, 200);
  assert.equal((await one.visitor.put(`/api/trades/${id}/offer`, { items: [], gold: 99999 })).statusCode, 409);
});

/**
 * The oldest rule a trade window has. Without it the moment between "they
 * agreed" and "the goods moved" is long enough to swap a legendary for a stick.
 */
test("changing either offer clears both agreements", async () => {
  const one = await player("one@example.com", [weapon(501), weapon(502)]);
  const two = await player("two@example.com", [weapon(601)]);
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  await one.visitor.put(`/api/trades/${id}/offer`, { items: [501], gold: 0 });
  await two.visitor.put(`/api/trades/${id}/offer`, { items: [601], gold: 0 });
  await two.visitor.post(`/api/trades/${id}/accept`);

  const beforeSwap = (await one.visitor.get(`/api/trades/${id}`)).json();
  assert.equal(beforeSwap.them.accepted, true);

  // The proposer quietly swaps what is on the table.
  await one.visitor.put(`/api/trades/${id}/offer`, { items: [502], gold: 0 });

  const afterSwap = (await one.visitor.get(`/api/trades/${id}`)).json();
  assert.equal(afterSwap.them.accepted, false, "their agreement must not survive the swap");
  assert.equal(afterSwap.you.accepted, false);
  assert.equal(fakeGame.settlements.length, 0);
});

test("when both agree the goods are asked for, once, with both sides", async () => {
  const one = await player("one@example.com", [weapon(501)]);
  const two = await player("two@example.com", [weapon(601)]);
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  await one.visitor.put(`/api/trades/${id}/offer`, { items: [501], gold: 250 });
  await two.visitor.put(`/api/trades/${id}/offer`, { items: [601], gold: 0 });
  await one.visitor.post(`/api/trades/${id}/accept`);
  assert.equal(fakeGame.settlements.length, 0, "one side agreeing settles nothing");

  const settled = await two.visitor.post(`/api/trades/${id}/accept`);
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().state, "settled");

  assert.equal(fakeGame.settlements.length, 1);
  const [parties] = fakeGame.settlements;
  const byAccount = Object.fromEntries(parties.map((party) => [party.accountId, party]));
  assert.deepEqual(byAccount[one.accountId], { accountId: one.accountId, items: [501], gold: 250 });
  assert.deepEqual(byAccount[two.accountId], { accountId: two.accountId, items: [601], gold: 0 });

  // And it cannot be settled twice by a late click.
  assert.equal((await one.visitor.post(`/api/trades/${id}/accept`)).statusCode, 409);
});

/**
 * Whatever the game server objected to has to be changed, and an agreement
 * that survives the change is the thing the clear-on-change rule prevents.
 */
test("a refusal from the game server keeps the trade open and clears agreements", async () => {
  const one = await player("one@example.com", [weapon(501)]);
  const two = await player("two@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  await one.visitor.put(`/api/trades/${id}/offer`, { items: [501], gold: 0 });
  await two.visitor.post(`/api/trades/${id}/accept`);

  fakeGame.refuseWith = new GameServerError(409, "account 1000000002 is in a dungeon");
  const refused = await one.visitor.post(`/api/trades/${id}/accept`);

  assert.equal(refused.statusCode, 409);
  assert.match(refused.json().error, /in a dungeon/);

  const after = (await one.visitor.get(`/api/trades/${id}`)).json();
  assert.equal(after.state, "open");
  assert.equal(after.you.accepted, false);
  assert.equal(after.them.accepted, false);
});

/** An offer is the only thing the other person has shown you. */
test("a trade shows their offer and not their bag", async () => {
  const one = await player("one@example.com");
  const two = await player("two@example.com", [weapon(601), weapon(602), weapon(603)]);
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  await two.visitor.put(`/api/trades/${id}/offer`, { items: [601], gold: 0 });

  const seen = (await one.visitor.get(`/api/trades/${id}`)).json();
  assert.deepEqual(seen.them.items.map((item) => item.id), [601]);
});

test("somebody else's trade does not exist as far as you are concerned", async () => {
  const one = await player("one@example.com");
  const two = await player("two@example.com");
  const stranger = await player("three@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  assert.equal((await stranger.visitor.get(`/api/trades/${id}`)).statusCode, 404);
  assert.equal((await stranger.visitor.post(`/api/trades/${id}/cancel`)).statusCode, 404);
});

test("cancelling closes it for both sides", async () => {
  const one = await player("one@example.com");
  const two = await player("two@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  assert.equal((await two.visitor.post(`/api/trades/${id}/cancel`)).statusCode, 200);
  assert.equal((await one.visitor.get(`/api/trades/${id}`)).json().state, "cancelled");
  assert.equal((await one.visitor.put(`/api/trades/${id}/offer`, { items: [], gold: 1 })).statusCode, 409);
});

/**
 * The point of the socket: the other person's screen changes as they watch,
 * rather than when they next click.
 */
test("the other side is pushed a change as it happens", async () => {
  const one = await player("one@example.com", [weapon(501)]);
  const two = await player("two@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/trades/${id}/live`, {
    headers: { cookie: two.visitor.cookieHeader() },
  });
  const seen = [];
  socket.on("message", (raw) => seen.push(JSON.parse(raw.toString())));
  await once(socket, "open");

  // The first frame is the trade as it stands.
  while (seen.length < 1) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(seen[0].you.items, []);

  await one.visitor.put(`/api/trades/${id}/offer`, { items: [501], gold: 40 });

  while (seen.length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
  const pushed = seen[1];
  assert.deepEqual(pushed.them.items.map((item) => item.id), [501], "their offer, from this side");
  assert.equal(pushed.them.gold, 40);

  socket.close();
});

test("a socket for a trade you are not in is closed", async () => {
  const one = await player("one@example.com");
  const two = await player("two@example.com");
  const stranger = await player("three@example.com");
  const { id } = (await one.visitor.post("/api/trades", { partnerAccountId: two.accountId })).json();

  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/trades/${id}/live`, {
    headers: { cookie: stranger.visitor.cookieHeader() },
  });
  const [code] = await once(socket, "close");
  assert.equal(code, 4004);
});
