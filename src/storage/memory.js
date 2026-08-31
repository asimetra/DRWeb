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


/* ------------------------------------------------------------------- life - */

export const ping = async () => {};

export const close = async () => {
  users.clear();
  sessions.clear();
  tokens.clear();
  nextUserId = 1;
};
