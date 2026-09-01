import { config } from "../config.js";
import { GameServerError } from "../game.js";

/**
 * What anybody may read without signing in.
 *
 * A server people are being invited to play on has to be able to say what it
 * is, how to reach it, and who is doing well on it, before it asks them for an
 * address and a password. Nothing here consults a session and nothing starts
 * one.
 */

/**
 * Answers, briefly remembered.
 *
 * What is behind these routes lives on the game server's internal API, which a
 * browser cannot reach and must not be able to — the credential that opens it
 * answers for every account. So this proxies, and because these are the routes
 * anybody on the internet can call without an account, they do not pass every
 * call through.
 *
 * How long is worth remembering is the caller's to say, because it is a fact
 * about the answer rather than about the cache: a board changes when somebody
 * finishes a run and fifteen seconds is invisible next to that, while the shop
 * changes once a day and would happily be held for an hour if it were not for
 * the minute either side of nine.
 */
const remembered = new Map();

export const forgetBoards = () => remembered.clear();

const briefly = async (key, ms, answer) => {
  const held = remembered.get(key);
  if (held && Date.now() - held.at < ms) return held.value;

  const value = await answer();
  remembered.set(key, { at: Date.now(), value, ms });

  // Swept while somebody is asking, so an idle process holds no work.
  if (remembered.size > 200) {
    for (const [other, entry] of remembered) {
      if (Date.now() - entry.at >= entry.ms) remembered.delete(other);
    }
  }
  return value;
};

const BOARD_MS = 15_000;
const SHOP_MS = 30_000;

const boardVia = (game, metric, scope) =>
  briefly(`board:${metric}?${new URLSearchParams(scope)}`, BOARD_MS, () =>
    game.readBoard(metric, scope)
  );

export const publicRoutes = async (app) => {
  app.get("/api/server", async () => ({
    /** The address a player types into their own client's configuration. */
    gameAddress: config.gameAddress,
  }));

  /**
   * `GET /api/status` — who is on and what has happened today.
   *
   * Open, and a count rather than a roster: it is the number in the margin of
   * every page, and a visitor deciding whether to download the client is
   * exactly who it is for.
   *
   * A game server that is down is not an error here. The site has plenty to
   * say without it — the boards are stored on this side of the wall — so the
   * margin goes quiet rather than the page failing.
   */
  app.get("/api/status", async () => {
    try {
      return await app.game.readStatus();
    } catch (problem) {
      if (problem instanceof GameServerError) return { reachable: false };
      throw problem;
    }
  });

  /**
   * `GET /api/leaderboards/:metric` — open, because a leaderboard nobody can
   * read without an account is a leaderboard doing half its job.
   *
   * The scope parameters are passed through rather than interpreted. Which
   * boards exist and what they need is the game server's business, and
   * duplicating that here would be a second opinion to keep in step.
   */
  app.get("/api/leaderboards/:metric", async (request, reply) => {
    const scope = {};
    for (const name of ["node", "hero", "party"]) {
      const value = Number(request.query?.[name]);
      if (Number.isSafeInteger(value) && value > 0) scope[name] = value;
    }
    scope.limit = Math.max(1, Math.min(100, Number(request.query?.limit) || 20));

    try {
      return await boardVia(app.game, request.params.metric, scope);
    } catch (failure) {
      if (!(failure instanceof GameServerError)) throw failure;
      request.log.warn(`leaderboard ${request.params.metric}: ${failure.message}`);
      return reply
        .code(failure.status === 404 || failure.status === 400 ? failure.status : 503)
        .send({ error: failure.message });
    }
  });

  /**
   * The shop, open like the boards are and for the same reason.
   *
   * It is the one page here that has nothing to do with having an account: what
   * the game is selling today, and what it will be selling next month. Somebody
   * who has not installed the client yet is a fair reader of it, and asking
   * them to sign up first would be asking for a password to see a shop window.
   *
   * Nothing is interpreted on the way past. Which day is in progress, how far
   * the schedule runs and what an offer *is* are all answers about the game's
   * tables, and this side holds none of them — the same division the market
   * keeps. See the game server's `store-rotation`.
   */
  const shopVia = async (request, reply, read, key) => {
    try {
      return key === null ? await read() : await briefly(key, SHOP_MS, read);
    } catch (failure) {
      if (!(failure instanceof GameServerError)) throw failure;
      request.log.warn(`shop: ${failure.message}`);
      return reply.code(failure.status === 400 ? 400 : 503).send({ error: failure.message });
    }
  };

  app.get("/api/shop", async (request, reply) => {
    const day = String(request.query?.day ?? "").slice(0, 10);
    const days = Math.max(1, Math.min(60, Number(request.query?.days) || 14));
    return shopVia(request, reply, () => app.game.readShop({ day, days }), `shop:${day}:${days}`);
  });

  /**
   * `GET /api/shop/schedule` — when is this next on the shelf?
   *
   * Not cached alongside the day, and not because it is expensive: a search is
   * one query per person typing, so a shared cache of every phrase anybody has
   * tried is a way of filling this process's memory from the outside. Only the
   * unsearched view — the plain list of what is coming — is worth holding, and
   * that is the one everybody lands on.
   */
  app.get("/api/shop/schedule", async (request, reply) => {
    const options = {
      q: String(request.query?.q ?? "").slice(0, 64),
      rarity: Math.max(0, Math.min(9, Number(request.query?.rarity) || 0)),
      from: String(request.query?.from ?? "").slice(0, 10),
      limit: Math.max(1, Math.min(100, Number(request.query?.limit) || 40)),
      offset: Math.max(0, Math.min(1_000_000, Number(request.query?.offset) || 0)),
    };
    const read = () => app.game.readShopSchedule(options);
    if (options.q) return shopVia(request, reply, read, null);

    const key = `schedule:${options.rarity}:${options.from}:${options.limit}:${options.offset}`;
    return shopVia(request, reply, read, key);
  });
};
