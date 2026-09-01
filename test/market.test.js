import assert from "node:assert/strict";
import test, { after, beforeEach } from "node:test";

process.env.ODW_STORAGE = "memory";
process.env.ODW_SESSION_SECRET = "b".repeat(48);
process.env.ODW_GAME_INTERNAL_TOKEN = "whatever-the-game-server-holds";

const { buildApp } = await import("../src/app.js");
const { GameServerError } = await import("../src/game.js");
const storage = await import("../src/storage/index.js");

/**
 * The game server, stood in for.
 *
 * The market itself is the other repository's, and is tested there — where a
 * weapon lives while it is up, what happens when two buyers reach for the same
 * listing, whether a full bag loses anything. What this repository has to get
 * right is narrower and is the whole reason it exists in front of that API:
 * *which account* each call is made for.
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
  calls: [],
  refuseWith: null,
  next: 1_000_000_001,
  names: new Set(),

  /** Names are the game server's to rule on; the double just remembers them. */
  async checkName(name) {
    const wanted = String(name ?? "").trim();
    if (wanted.length < 3) {
      return { name: wanted, free: false, reason: "bad_name", error: "a name is 3 to 16 characters" };
    }
    const key = wanted.toLowerCase();
    return { name: wanted, free: !fakeGame.names.has(key), ...(fakeGame.names.has(key) ? { reason: "name_taken" } : {}) };
  },

  async registerAccount({ name } = {}) {
    if (name) fakeGame.names.add(String(name).toLowerCase());
    const accountId = fakeGame.next++;
    fakeGame.accounts.set(accountId, { id: accountId, basic_currency: 1000, account_items: [] });
    return { accountId, token: `${Math.floor(Date.now() / 1000) + 3600}:${"a".repeat(64)}` };
  },
  async readAccount(accountId) {
    return fakeGame.accounts.get(Number(accountId));
  },
  /*
   * Which weapons are on offer, and what they are called, are the game
   * server's answers now — this stands in for them rather than working them
   * out again, which is the point of the endpoint existing.
   */
  async readInventory(accountId) {
    const account = fakeGame.accounts.get(Number(accountId));
    return {
      accountId: account.id,
      gold: Number(account.basic_currency ?? 0),
      items: (account.account_items ?? [])
        .filter((item) => !Number(item.avatar_id ?? 0))
        .map((item) => ({ ...item, name: `Weapon ${item.item_id}`, modifiers: [] })),
    };
  },
  async reissueToken(accountId) {
    return { accountId, token: "x" };
  },
  async revokeTokens(accountId) {
    return { accountId, generation: 1 };
  },

  async readMarket(limit) {
    fakeGame.calls.push(["readMarket", limit]);
    return { listings: [{ id: 501, seller_id: 9, price: 400, name: "Long Sword" }] };
  },
  async readStall(accountId) {
    fakeGame.calls.push(["readStall", accountId]);
    return { account_id: accountId, listed: [], sold: [], owed: 0 };
  },
  async listForSale(sellerId, itemId, price) {
    if (fakeGame.refuseWith) throw fakeGame.refuseWith;
    fakeGame.calls.push(["listForSale", sellerId, itemId, price]);
    return { id: itemId, seller_id: sellerId, price };
  },
  async buyListing(listingId, buyerId) {
    if (fakeGame.refuseWith) throw fakeGame.refuseWith;
    fakeGame.calls.push(["buyListing", Number(listingId), buyerId]);
    return { listing: Number(listingId), buyer_id: buyerId };
  },
  async cancelListing(listingId, sellerId) {
    if (fakeGame.refuseWith) throw fakeGame.refuseWith;
    fakeGame.calls.push(["cancelListing", Number(listingId), sellerId]);
    return { listing: Number(listingId) };
  },
  async claimProceeds(accountId) {
    if (fakeGame.refuseWith) throw fakeGame.refuseWith;
    fakeGame.calls.push(["claimProceeds", accountId]);
    return { claimed: 400, gold: 1400, listings: [] };
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

after(async () => {
  await app.close();
  await storage.close();
});

beforeEach(async () => {
  fakeGame.accounts.clear();
  fakeGame.calls.length = 0;
  fakeGame.refuseWith = null;
  fakeGame.names.clear();
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
    get: (url) => send("GET", url),
    post: async (url, body) => send("POST", url, body, { "x-csrf-token": await csrf() }),
    postWithoutCsrf: (url, body) => send("POST", url, body),
  };
};

/** A signed-in, confirmed player holding the weapons given. */
let named = 0;
const player = async (email, items = []) => {
  const visitor = browser();
  await visitor.post("/api/register", {
    email,
    password: "a-long-enough-password",
    name: `Player${++named}`,
  });
  const { game } = (await visitor.post("/api/verify", { token: fakeMailer.sent.at(-1).token })).json();
  fakeGame.accounts.get(game.accountId).account_items = items;
  return { visitor, accountId: game.accountId };
};

/**
 * The rule the whole file exists for.
 *
 * The game server's internal API is behind a shared token and will act on
 * whatever account id it is handed. A `sellerId` the caller could choose would
 * therefore be a way to sell somebody else's weapons, so the id comes from the
 * session and the body's opinion of it is ignored.
 */
test("the account acted on is the session's, whatever the request says", async () => {
  const me = await player("me@example.com", [weapon(501)]);
  const victim = await player("victim@example.com", [weapon(777)]);

  await me.visitor.post("/api/market", {
    itemId: 501,
    price: 300,
    sellerId: victim.accountId,
    accountId: victim.accountId,
  });

  assert.deepEqual(fakeGame.calls, [["listForSale", me.accountId, 501, 300]]);
});

test("buying, cancelling and claiming are all the session's account", async () => {
  const me = await player("me@example.com");
  const other = await player("other@example.com");

  await me.visitor.post("/api/market/501/buy", { buyerId: other.accountId });
  await me.visitor.post("/api/market/502/cancel", { sellerId: other.accountId });
  await me.visitor.post("/api/market/claim", { accountId: other.accountId });
  await me.visitor.get("/api/market/stall");

  assert.deepEqual(fakeGame.calls, [
    ["buyListing", 501, me.accountId],
    ["cancelListing", 502, me.accountId],
    ["claimProceeds", me.accountId],
    ["readStall", me.accountId],
  ]);
});

/**
 * A market nobody can look at before joining is a market nobody joins for.
 * Looking is open; taking part is not.
 */
test("anybody may look, only a player may take part", async () => {
  const visitor = browser();

  const looking = await visitor.get("/api/market");
  assert.equal(looking.statusCode, 200);
  assert.equal(looking.json().listings.length, 1);

  for (const [url, body] of [
    ["/api/market", { itemId: 1, price: 1 }],
    ["/api/market/501/buy", {}],
    ["/api/market/501/cancel", {}],
    ["/api/market/claim", {}],
  ]) {
    const refused = await visitor.post(url, body);
    assert.equal(refused.statusCode, 401, `${url} is not open`);
  }
  assert.deepEqual(fakeGame.calls.filter(([name]) => name !== "readMarket"), []);
});

test("a signed-in browser cannot mutate the market without its CSRF token", async () => {
  const me = await player("csrf@example.com", [weapon(501)]);
  const before = [...fakeGame.calls];

  for (const [url, body] of [
    ["/api/market", { itemId: 501, price: 100 }],
    ["/api/market/501/buy", {}],
    ["/api/market/501/cancel", {}],
    ["/api/market/claim", {}],
  ]) {
    const response = await me.visitor.postWithoutCsrf(url, body);
    assert.equal(response.statusCode, 403, url);
  }
  assert.deepEqual(fakeGame.calls, before, "no rejected request reaches the privileged game API");
});

/** Signed up but not confirmed: there is no account to sell out of yet. */
test("an unconfirmed account is told to confirm rather than refused as a stranger", async () => {
  const visitor = browser();
  await visitor.post("/api/register", {
    email: "new@example.com",
    password: "a-long-enough-password",
    name: "Unconfirmed",
  });

  const refused = await visitor.post("/api/market", { itemId: 1, price: 1 });
  assert.equal(refused.statusCode, 409);
  assert.match(refused.json().error, /confirm/i);
});

/**
 * "Somebody bought it first" is an answer, not a fault. It reaches the screen
 * with its own status so the row can be taken off the page rather than the
 * page showing a failure.
 */
test("a refusal from the game server arrives with its own status", async () => {
  const me = await player("me@example.com");

  fakeGame.refuseWith = new GameServerError(410, "listing 501 is no longer up");
  const gone = await me.visitor.post("/api/market/501/buy", {});
  assert.equal(gone.statusCode, 410);
  assert.match(gone.json().error, /no longer up/);

  fakeGame.refuseWith = new GameServerError(409, "account 1 would hold 4 of 3 slots");
  const full = await me.visitor.post("/api/market/501/buy", {});
  assert.equal(full.statusCode, 409);
});

test("the inventory offered is what is unequipped", async () => {
  const me = await player("me@example.com", [weapon(501), weapon(502, { avatar_id: 9 })]);

  const bag = (await me.visitor.get("/api/inventory")).json();
  assert.deepEqual(bag.items.map((item) => item.id), [501], "a worn weapon is not on offer");
  assert.equal(bag.gold, 1000);
});
