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
 * Standings, briefly remembered.
 *
 * The boards live behind the game server's internal API, which a browser
 * cannot reach and must not be able to — the credential that opens it answers
 * for every account. So this proxies, and because it is the one route here
 * that anybody on the internet can call without an account, it does not pass
 * every call through: a board changes when somebody finishes a run, and
 * fifteen seconds of staleness is invisible next to that.
 */
const CACHE_MS = 15_000;
const remembered = new Map();

export const forgetBoards = () => remembered.clear();

const boardVia = async (game, metric, scope) => {
  const key = `${metric}?${new URLSearchParams(scope)}`;
  const held = remembered.get(key);
  if (held && Date.now() - held.at < CACHE_MS) return held.board;

  const board = await game.readBoard(metric, scope);
  remembered.set(key, { at: Date.now(), board });

  // Swept while somebody is asking, so an idle process holds no work.
  if (remembered.size > 200) {
    for (const [other, entry] of remembered) {
      if (Date.now() - entry.at >= CACHE_MS) remembered.delete(other);
    }
  }
  return board;
};

export const publicRoutes = async (app) => {
  app.get("/api/server", async () => ({
    /** The address a player types into their own client's configuration. */
    gameAddress: config.gameAddress,
  }));

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
};
