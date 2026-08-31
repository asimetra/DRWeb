import { EmailTaken } from "./errors.js";

/**
 * Everything in the process, lost on restart.
 *
 * For the tests, which should not need a database standing behind them to say
 * whether signing up works, and for trying the thing out. It is the same shape
 * as the Postgres backend and nothing above it can tell them apart, which is
 * the only reason a test against this one proves anything about the other.
 */
const users = new Map();
const sessions = new Map();
const tokens = new Map();
let nextUserId = 1;

const folded = (email) => String(email).trim().toLowerCase();
const copy = (user) => (user ? { ...user } : null);

export const createUser = async ({ email, passwordHash }) => {
  for (const user of users.values()) {
    if (folded(user.email) === folded(email)) throw new EmailTaken(email);
  }
  const user = {
    id: nextUserId++,
    email: String(email).trim(),
    password_hash: passwordHash,
    account_id: null,
    verified_at: null,
    created: new Date(),
    last_login: null,
  };
  users.set(user.id, user);
  return copy(user);
};

export const findUserByEmail = async (email) => {
  for (const user of users.values()) {
    if (folded(user.email) === folded(email)) return copy(user);
  }
  return null;
};

export const findUserById = async (id) => copy(users.get(Number(id)));

export const findUserByAccountId = async (accountId) => {
  for (const user of users.values()) {
    if (Number(user.account_id) === Number(accountId)) return copy(user);
  }
  return null;
};

export const linkAccount = async (userId, accountId) => {
  const user = users.get(Number(userId));
  if (user) user.account_id = Number(accountId);
};

export const deleteUser = async (id) => {
  users.delete(Number(id));
  for (const [key, session] of sessions) {
    if (Number(session.userId) === Number(id)) sessions.delete(key);
  }
};

export const touchLogin = async (id) => {
  const user = users.get(Number(id));
  if (user) user.last_login = new Date();
};

export const setSession = async (id, { data, expires, userId = null }) => {
  sessions.set(id, { data, expires, userId: userId === null ? null : Number(userId) });
};

export const getSession = async (id) => {
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expires.getTime() <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session.data;
};

export const destroySession = async (id) => {
  sessions.delete(id);
};

/** Signing out everywhere, which is what a password change has to be able to do. */
export const destroyUserSessions = async (userId) => {
  for (const [key, session] of sessions) {
    if (Number(session.userId) === Number(userId)) sessions.delete(key);
  }
};

export const markVerified = async (id) => {
  const user = users.get(Number(id));
  if (user) user.verified_at = new Date();
};

export const createToken = async ({ userId, tokenHash, purpose, expires }) => {
  tokens.set(tokenHash, { userId: Number(userId), purpose, expires });
};

export const findToken = async (tokenHash, purpose) => {
  const row = tokens.get(tokenHash);
  if (!row || row.purpose !== purpose) return null;
  if (row.expires.getTime() <= Date.now()) {
    tokens.delete(tokenHash);
    return null;
  }
  return { userId: row.userId };
};

export const consumeToken = async (tokenHash) => {
  tokens.delete(tokenHash);
};

/** Asking for a new link retires the earlier ones, so an old mail stops working. */
export const deleteUserTokens = async (userId, purpose) => {
  for (const [key, row] of tokens) {
    if (row.userId === Number(userId) && row.purpose === purpose) tokens.delete(key);
  }
};

export const setPassword = async (id, passwordHash) => {
  const user = users.get(Number(id));
  if (user) user.password_hash = passwordHash;
};

/* ------------------------------------------------------------------ trades - */

const trades = new Map();
let nextTradeId = 1;

const tradeCopy = (trade) =>
  trade && {
    ...trade,
    offers: Object.fromEntries(
      Object.entries(trade.offers).map(([key, offer]) => [key, { ...offer, items: [...offer.items] }])
    ),
  };

export const createTrade = async ({ proposerId, partnerId }) => {
  const trade = {
    id: nextTradeId++,
    proposer_id: Number(proposerId),
    partner_id: Number(partnerId),
    state: "open",
    created: new Date(),
    closed: null,
    offers: {
      [Number(proposerId)]: { items: [], gold: 0, accepted: false },
      [Number(partnerId)]: { items: [], gold: 0, accepted: false },
    },
  };
  trades.set(trade.id, trade);
  return tradeCopy(trade);
};

export const findTrade = async (id) => tradeCopy(trades.get(Number(id)));

/** The open trade between these two, if there is one; a pair may only have one. */
export const findOpenTradeBetween = async (first, second) => {
  for (const trade of trades.values()) {
    if (trade.state !== "open") continue;
    const ids = [trade.proposer_id, trade.partner_id];
    if (ids.includes(Number(first)) && ids.includes(Number(second))) return tradeCopy(trade);
  }
  return null;
};

export const openTradesFor = async (userId) =>
  [...trades.values()]
    .filter(
      (trade) =>
        trade.state === "open" &&
        (trade.proposer_id === Number(userId) || trade.partner_id === Number(userId))
    )
    .map(tradeCopy);

export const setTradeOffer = async (tradeId, userId, { items, gold }) => {
  const trade = trades.get(Number(tradeId));
  if (!trade) return null;
  trade.offers[Number(userId)] = { items: [...items], gold: Number(gold), accepted: false };
  // Either offer changing clears both agreements.
  for (const offer of Object.values(trade.offers)) offer.accepted = false;
  return tradeCopy(trade);
};

export const setTradeAccepted = async (tradeId, userId, accepted) => {
  const trade = trades.get(Number(tradeId));
  if (!trade) return null;
  trade.offers[Number(userId)].accepted = Boolean(accepted);
  return tradeCopy(trade);
};

export const closeTrade = async (tradeId, state) => {
  const trade = trades.get(Number(tradeId));
  if (!trade) return null;
  trade.state = state;
  trade.closed = new Date();
  return tradeCopy(trade);
};

export const ping = async () => {};

export const close = async () => {
  users.clear();
  sessions.clear();
  tokens.clear();
  trades.clear();
  nextTradeId = 1;
  nextUserId = 1;
};
