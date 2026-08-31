import * as storage from "../storage/index.js";
import { GameServerError } from "../game.js";

/**
 * The market, from the website's side.
 *
 * There is almost nothing here, and that is the design. A listed weapon has
 * left a bag and a sale moves gold between two accounts, so every part of it is
 * game state and belongs to the server that owns the accounts — this
 * application's whole job is to say *who is asking*.
 *
 * That job is the security of the thing. The game server's internal API is
 * behind a shared token and will act on whatever account id it is handed, so
 * the one rule every route here keeps is that the id comes from the session and
 * never from the request body. A `sellerId` a caller could choose would be a
 * way to sell somebody else's weapons.
 */

const requireTrader = async (request, reply) => {
  const userId = request.session?.userId;
  if (!userId) return reply.code(401).send({ error: "not signed in" });

  const user = await storage.findUserById(userId);
  if (!user) {
    await request.session.destroy();
    return reply.code(401).send({ error: "not signed in" });
  }
  if (!user.account_id) {
    return reply.code(409).send({ error: "confirm your email address first" });
  }
  request.user = user;
};

/**
 * The game server's refusals, passed through with their reason.
 *
 * They are answers rather than faults: "somebody bought it first" and "your bag
 * is full" are both things the screen has to say differently, and flattening
 * them into a 500 would make the market unusable exactly when it is busy.
 */
const relay = (reply, problem) => {
  if (!(problem instanceof GameServerError)) throw problem;
  return reply.code(problem.status).send({ error: problem.message });
};

export const marketRoutes = async (app) => {
  /**
   * What this person could put up: asked for, rather than worked out here.
   *
   * This read the whole account and kept the weapons nobody was holding, which
   * meant knowing that an `avatar_id` is what being equipped looks like — and
   * it still left the sell list offering "item 11001", because turning an id
   * into a name needs game data this side does not have and is not meant to.
   * Both are the game server's answers, so it gives them.
   */
  app.get("/api/inventory", { onRequest: requireTrader }, async (request) =>
    app.game.readInventory(request.user.account_id)
  );

  /**
   * Everything up for sale. Readable signed out: a market nobody can look at
   * before joining is a market nobody joins for.
   */
  app.get("/api/market", async (request) => {
    const limit = Number(request.query?.limit) || 50;
    return app.game.readMarket(limit);
  });

  /** This person's own: what is still up, and what is waiting to be collected. */
  app.get("/api/market/stall", { onRequest: requireTrader }, async (request) =>
    app.game.readStall(request.user.account_id)
  );

  app.post("/api/market", { onRequest: requireTrader }, async (request, reply) => {
    try {
      return await app.game.listForSale(
        request.user.account_id,
        request.body?.itemId,
        request.body?.price
      );
    } catch (problem) {
      return relay(reply, problem);
    }
  });

  app.post("/api/market/:id/buy", { onRequest: requireTrader }, async (request, reply) => {
    try {
      return await app.game.buyListing(request.params.id, request.user.account_id);
    } catch (problem) {
      return relay(reply, problem);
    }
  });

  app.post("/api/market/:id/cancel", { onRequest: requireTrader }, async (request, reply) => {
    try {
      return await app.game.cancelListing(request.params.id, request.user.account_id);
    } catch (problem) {
      return relay(reply, problem);
    }
  });

  app.post("/api/market/claim", { onRequest: requireTrader }, async (request, reply) => {
    try {
      return await app.game.claimProceeds(request.user.account_id);
    } catch (problem) {
      return relay(reply, problem);
    }
  });
};
