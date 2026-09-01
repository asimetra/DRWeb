import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";
import { EmailTaken } from "./errors.js";

/**
 * The `web` schema, in the game's database.
 *
 * Nothing here touches `public`. The one reference that crosses — a user's
 * `account_id` — is a foreign key the database enforces and this process never
 * writes an account row behind it; it asks the game server to, over the
 * internal API. See src/game.js.
 */

/** int8 as a number: user ids and account ids are far inside what one holds exactly. */
pg.types.setTypeParser(20, Number);

let pool = null;
const transactionClient = new AsyncLocalStorage();

const connect = () => {
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
  return pool;
};

const query = (...args) => (transactionClient.getStore() ?? connect()).query(...args);

/** Postgres' unique-violation class, which is how a duplicate address arrives. */
const UNIQUE_VIOLATION = "23505";

export const createUser = async ({ email, passwordHash, wantedName = null }) => {
  try {
    const { rows } = await query(
      `INSERT INTO web.users (email, password_hash, wanted_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, password_hash, account_id, wanted_name, verified_at, created, last_login`,
      [String(email).trim(), passwordHash, wantedName]
    );
    return rows[0];
  } catch (problem) {
    if (problem.code === UNIQUE_VIOLATION) throw new EmailTaken(email);
    throw problem;
  }
};

export const findUserByEmail = async (email) => {
  const { rows } = await query(
    `SELECT id, email, password_hash, account_id, wanted_name, verified_at, created, last_login
       FROM web.users WHERE lower(email) = lower($1)`,
    [String(email).trim()]
  );
  return rows[0] ?? null;
};

export const findUserById = async (id) => {
  const { rows } = await query(
    `SELECT id, email, password_hash, account_id, wanted_name, verified_at, created, last_login
       FROM web.users WHERE id = $1`,
    [Number(id)]
  );
  return rows[0] ?? null;
};

export const findUserByAccountId = async (accountId) => {
  const { rows } = await query(
    `SELECT id, email, password_hash, account_id, wanted_name, verified_at, created, last_login
       FROM web.users WHERE account_id = $1`,
    [Number(accountId)]
  );
  return rows[0] ?? null;
};

export const linkAccount = async (userId, accountId) => {
  await query("UPDATE web.users SET account_id = $2 WHERE id = $1", [
    Number(userId),
    Number(accountId),
  ]);
};

export const deleteUser = async (id) => {
  await query("DELETE FROM web.users WHERE id = $1", [Number(id)]);
};

export const touchLogin = async (id) => {
  await query("UPDATE web.users SET last_login = now() WHERE id = $1", [Number(id)]);
};

export const setSession = async (id, { data, expires, userId = null }) => {
  await query(
    `INSERT INTO web.sessions (id, user_id, data, expires)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE SET user_id = $2, data = $3, expires = $4`,
    [id, userId === null ? null : Number(userId), JSON.stringify(data), expires]
  );
};

/**
 * Expiry is checked in the query rather than swept on a timer: a row that has
 * run out must not be honoured even while it is still sitting in the table.
 */
export const getSession = async (id) => {
  const { rows } = await query(
    "SELECT data FROM web.sessions WHERE id = $1 AND expires > now()",
    [id]
  );
  return rows[0]?.data ?? null;
};

export const destroySession = async (id) => {
  await query("DELETE FROM web.sessions WHERE id = $1", [id]);
};

export const destroyUserSessions = async (userId) => {
  await query("DELETE FROM web.sessions WHERE user_id = $1", [Number(userId)]);
};

/** Also clears whatever has run out, since something has to and this runs often enough. */
export const sweepExpiredSessions = async () => {
  const { rowCount } = await query("DELETE FROM web.sessions WHERE expires <= now()");
  return rowCount;
};

export const markVerified = async (id) => {
  await query("UPDATE web.users SET verified_at = now() WHERE id = $1", [Number(id)]);
};

export const createToken = async ({ userId, tokenHash, purpose, expires }) => {
  await query(
    "INSERT INTO web.tokens (token_hash, user_id, purpose, expires) VALUES ($1, $2, $3, $4)",
    [tokenHash, Number(userId), purpose, expires]
  );
};

/** Retires prior links and inserts one replacement atomically. */
export const replaceUserToken = async ({ userId, tokenHash, purpose, expires }) => {
  const id = Number(userId);
  const replace = async (client) => {
    await client.query("DELETE FROM web.tokens WHERE user_id = $1 AND purpose = $2", [id, purpose]);
    await client.query(
      "INSERT INTO web.tokens (token_hash, user_id, purpose, expires) VALUES ($1, $2, $3, $4)",
      [tokenHash, id, purpose, expires]
    );
  };

  const held = transactionClient.getStore();
  if (held) return replace(held);

  const client = await connect().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `user-token:${id}:${purpose}`,
    ]);
    await replace(client);
    await client.query("COMMIT");
  } catch (problem) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw problem;
  } finally {
    client.release();
  }
};

/**
 * Expiry and purpose are both in the query. A row that has run out must not be
 * honoured while it is still sitting in the table, and a confirmation link must
 * not be spendable on the password route.
 */
export const findToken = async (tokenHash, purpose) => {
  const { rows } = await query(
    `SELECT user_id FROM web.tokens
      WHERE token_hash = $1 AND purpose = $2 AND expires > now()`,
    [tokenHash, purpose]
  );
  return rows[0] ? { userId: rows[0].user_id } : null;
};

export const consumeToken = async (tokenHash) => {
  await query("DELETE FROM web.tokens WHERE token_hash = $1", [tokenHash]);
};

export const setPassword = async (id, passwordHash) => {
  await query("UPDATE web.users SET password_hash = $2 WHERE id = $1", [
    Number(id),
    passwordHash,
  ]);
};

/**
 * One redemption per token across every web process sharing this database.
 * All storage calls made by `work` stay on this transaction's client, avoiding
 * a pool deadlock while the advisory lock is held.
 */
export const withTokenLock = async (tokenHash, work) => {
  const client = await connect().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [String(tokenHash)]);
    const result = await transactionClient.run(client, work);
    await client.query("COMMIT");
    return result;
  } catch (problem) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw problem;
  } finally {
    client.release();
  }
};


/* ------------------------------------------------------------------- life - */

export const ping = async () => {
  await query("SELECT 1");
};

export const close = async () => {
  await pool?.end();
  pool = null;
};
