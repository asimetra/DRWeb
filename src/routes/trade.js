import * as storage from "../storage/index.js";
import { GameServerError } from "../game.js";

/**
 * The trade screen's half of a trade: the negotiation.
 *
 * Who proposed it, what each side is offering and who has agreed is a
 * conversation, and a conversation is not game state — so it lives in this
 * application's own tables. The game server is asked exactly once, at the
 * moment both sides have agreed, and it moves the goods on one transaction.
 *
 * The rule that matters most here is the oldest one a trade window has: any
 * change to either offer clears both agreements. Without it, the window
 * between "they agreed" and "the goods moved" is long enough to swap a
 * legendary for a stick.
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

/** The trade, if this person is in it. Anything else is a 404 rather than a 403. */
const tradeFor = async (user, tradeId) => {
  const trade = await storage.findTrade(tradeId);
  if (!trade) return null;
  if (trade.proposer_id !== user.id && trade.partner_id !== user.id) return null;
  return trade;
};

const otherSide = (trade, userId) =>
  trade.proposer_id === Number(userId) ? trade.partner_id : trade.proposer_id;

/**
 * What a trade looks like from one side.
 *
 * The other person's offer is resolved into real weapons so the screen can
 * show what is on the table; the rest of their inventory is not, and must not
 * be — an offer is the only thing they have shown you.
 */
const viewFor = async (app, trade, userId) => {
  const theirId = otherSide(trade, userId);
  const [you, them] = await Promise.all([
    storage.findUserById(userId),
    storage.findUserById(theirId),
  ]);

  const resolve = async (user, offer) => {
    const account = await app.game.readAccount(user.account_id);
    const held = new Map((account.account_items ?? []).map((item) => [Number(item.id), item]));
    return {
      accountId: user.account_id,
      gold: offer.gold,
      accepted: offer.accepted,
      items: offer.items
        .map((id) => held.get(Number(id)))
        .filter(Boolean)
        .map((item) => ({
          id: Number(item.id),
          itemId: item.item_id,
          power: item.power,
          rarity: item.rarity,
          level: item.requiredlevel,
        })),
    };
  };

  return {
    id: trade.id,
    state: trade.state,
    you: await resolve(you, trade.offers[Number(userId)]),
    them: await resolve(them, trade.offers[Number(theirId)]),
  };
};

/* ------------------------------------------------------------- live push - */

/**
 * Who is watching which trade.
 *
 * Process-local, deliberately: one web process holds all of its own sockets,
 * and a second one would need a channel between them rather than a bigger map.
 * That is a problem for the day there is a second one.
 */
const watchers = new Map();

const watch = (tradeId, entry) => {
  const key = Number(tradeId);
  if (!watchers.has(key)) watchers.set(key, new Set());
  watchers.get(key).add(entry);
  return () => {
    watchers.get(key)?.delete(entry);
    if (!watchers.get(key)?.size) watchers.delete(key);
  };
};

/**
 * Everybody watching gets the trade from their own side, so the push is built
 * per socket rather than once — "you" and "them" are different objects
 * depending on who is asking.
 */
const announce = async (app, tradeId) => {
  const listening = watchers.get(Number(tradeId));
  if (!listening?.size) return;

  const trade = await storage.findTrade(tradeId);
  if (!trade) return;

  for (const entry of listening) {
    try {
      entry.socket.send(JSON.stringify(await viewFor(app, trade, entry.userId)));
    } catch (problem) {
      app.log.warn(`trade ${tradeId}: could not push to ${entry.userId}: ${problem.message}`);
    }
  }
};

/* ---------------------------------------------------------------- routes - */

export const tradeRoutes = async (app) => {
  /** What this person can put on a table: unequipped weapons, and gold. */
  app.get("/api/inventory", { onRequest: requireTrader }, async (request) => {
    const account = await app.game.readAccount(request.user.account_id);
    return {
      accountId: account.id,
      gold: Number(account.basic_currency ?? 0),
      items: (account.account_items ?? [])
        .filter((item) => !Number(item.avatar_id ?? 0))
        .map((item) => ({
          id: Number(item.id),
          itemId: item.item_id,
          power: item.power,
          rarity: item.rarity,
          level: item.requiredlevel,
        })),
    };
  });

  app.get("/api/trades", { onRequest: requireTrader }, async (request) => {
    const open = await storage.openTradesFor(request.user.id);
    return {
      trades: await Promise.all(open.map((trade) => viewFor(app, trade, request.user.id))),
    };
  });

  /**
   * Opening one with somebody, named by the account id their client uses —
   * the number they can read off their own screen, rather than the address
   * they signed up with.
   *
   * A pair gets one open trade. Asking again hands back the one already
   * running, so that two people both clicking "trade" do not end up
   * negotiating in two different windows.
   */
  app.post(
    "/api/trades",
    {
      onRequest: [requireTrader, app.csrfProtection],
      config: { rateLimit: { max: 30, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const partnerAccountId = Number(request.body?.partnerAccountId);
      if (!Number.isSafeInteger(partnerAccountId) || partnerAccountId <= 0) {
        return reply.code(400).send({ error: "give the account id you want to trade with" });
      }
      if (partnerAccountId === Number(request.user.account_id)) {
        return reply.code(400).send({ error: "you cannot trade with yourself" });
      }

      const partner = await storage.findUserByAccountId(partnerAccountId);
      if (!partner) return reply.code(404).send({ error: "no account here has that id" });

      const running = await storage.findOpenTradeBetween(request.user.id, partner.id);
      const trade = running ?? (await storage.createTrade({
        proposerId: request.user.id,
        partnerId: partner.id,
      }));

      await announce(app, trade.id);
      return reply.code(running ? 200 : 201).send(await viewFor(app, trade, request.user.id));
    }
  );

  app.get("/api/trades/:id", { onRequest: requireTrader }, async (request, reply) => {
    const trade = await tradeFor(request.user, request.params.id);
    if (!trade) return reply.code(404).send({ error: "no such trade" });
    return viewFor(app, trade, request.user.id);
  });

  /**
   * Putting something on the table, or taking it off. Both agreements are
   * cleared by the write itself — see the storage layer, where it is one
   * transaction with the change.
   */
  app.put("/api/trades/:id/offer", { onRequest: [requireTrader, app.csrfProtection] }, async (request, reply) => {
    const trade = await tradeFor(request.user, request.params.id);
    if (!trade) return reply.code(404).send({ error: "no such trade" });
    if (trade.state !== "open") return reply.code(409).send({ error: "this trade is closed" });

    const gold = Number(request.body?.gold ?? 0);
    const items = request.body?.items;
    if (!Array.isArray(items) || !Number.isSafeInteger(gold) || gold < 0) {
      return reply.code(400).send({ error: "an offer is a list of item ids and an amount of gold" });
    }

    /**
     * Checked here as well as at settlement. The game server is the authority
     * and refuses the same things, but a trade screen that lets somebody offer
     * a weapon they are wearing and only says so at the end is a trade screen
     * that wastes both people's time.
     */
    const account = await app.game.readAccount(request.user.account_id);
    const available = new Map(
      (account.account_items ?? [])
        .filter((item) => !Number(item.avatar_id ?? 0))
        .map((item) => [Number(item.id), item])
    );
    const wanted = items.map(Number);
    if (new Set(wanted).size !== wanted.length) {
      return reply.code(400).send({ error: "the same weapon is offered twice" });
    }
    const missing = wanted.find((id) => !available.has(id));
    if (missing !== undefined) {
      return reply
        .code(409)
        .send({ error: `weapon ${missing} is not in your bag, or is equipped` });
    }
    if (gold > Number(account.basic_currency ?? 0)) {
      return reply.code(409).send({ error: "you do not have that much gold" });
    }

    await storage.setTradeOffer(trade.id, request.user.id, { items: wanted, gold });
    await announce(app, trade.id);
    return viewFor(app, await storage.findTrade(trade.id), request.user.id);
  });

  /**
   * Agreeing, and settling when the other side already has.
   *
   * A refusal from the game server clears both agreements rather than leaving
   * them standing: whatever it objected to has to be changed, and an agreement
   * that survives the change is the thing the clear-on-change rule exists to
   * prevent.
   */
  app.post("/api/trades/:id/accept", { onRequest: [requireTrader, app.csrfProtection] }, async (request, reply) => {
    const trade = await tradeFor(request.user, request.params.id);
    if (!trade) return reply.code(404).send({ error: "no such trade" });
    if (trade.state !== "open") return reply.code(409).send({ error: "this trade is closed" });

    const agreed = await storage.setTradeAccepted(trade.id, request.user.id, true);
    const theirId = otherSide(trade, request.user.id);

    if (!agreed.offers[theirId].accepted) {
      await announce(app, trade.id);
      return viewFor(app, agreed, request.user.id);
    }

    const [you, them] = await Promise.all([
      storage.findUserById(request.user.id),
      storage.findUserById(theirId),
    ]);

    try {
      await app.game.settleTrade([
        {
          accountId: you.account_id,
          items: agreed.offers[Number(you.id)].items,
          gold: agreed.offers[Number(you.id)].gold,
        },
        {
          accountId: them.account_id,
          items: agreed.offers[Number(them.id)].items,
          gold: agreed.offers[Number(them.id)].gold,
        },
      ]);
    } catch (failure) {
      if (!(failure instanceof GameServerError)) throw failure;

      await storage.setTradeOffer(trade.id, request.user.id, agreed.offers[Number(you.id)]);
      await announce(app, trade.id);
      request.log.warn(`trade ${trade.id} refused: ${failure.message}`);
      return reply.code(409).send({ error: failure.message });
    }

    const settled = await storage.closeTrade(trade.id, "settled");
    await announce(app, trade.id);
    request.log.info(`trade ${trade.id} settled between ${you.id} and ${them.id}`);
    return viewFor(app, settled, request.user.id);
  });

  app.post("/api/trades/:id/cancel", { onRequest: [requireTrader, app.csrfProtection] }, async (request, reply) => {
    const trade = await tradeFor(request.user, request.params.id);
    if (!trade) return reply.code(404).send({ error: "no such trade" });
    if (trade.state !== "open") return reply.code(409).send({ error: "this trade is closed" });

    const cancelled = await storage.closeTrade(trade.id, "cancelled");
    await announce(app, trade.id);
    return viewFor(app, cancelled, request.user.id);
  });

  /**
   * The live view. Everything above pushes here after it writes, so the other
   * person's screen changes as they watch rather than when they next click.
   */
  app.get(
    "/api/trades/:id/live",
    { websocket: true },
    async (socket, request) => {
      const userId = request.session?.userId;
      const user = userId ? await storage.findUserById(userId) : null;
      const trade = user ? await tradeFor(user, request.params.id) : null;

      if (!trade) {
        socket.close(4004, "no such trade");
        return;
      }

      const stop = watch(trade.id, { socket, userId: user.id });
      socket.on("close", stop);
      socket.on("error", stop);

      socket.send(JSON.stringify(await viewFor(app, trade, user.id)));
    }
  );
};
