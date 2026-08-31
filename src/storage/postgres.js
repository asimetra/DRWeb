import pg from "pg";
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

const connect = () => {
  pool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
  return pool;
};

/** Postgres' unique-violation class, which is how a duplicate address arrives. */
const UNIQUE_VIOLATION = "23505";

export const createUser = async ({ email, passwordHash }) => {
  try {
    const { rows } = await connect().query(
      `INSERT INTO web.users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, password_hash, account_id, verified_at, created, last_login`,
      [String(email).trim(), passwordHash]
    );
    return rows[0];
  } catch (problem) {
    if (problem.code === UNIQUE_VIOLATION) throw new EmailTaken(email);
    throw problem;
  }
};

export const findUserByEmail = async (email) => {
  const { rows } = await connect().query(
    `SELECT id, email, password_hash, account_id, verified_at, created, last_login
       FROM web.users WHERE lower(email) = lower($1)`,
    [String(email).trim()]
  );
  return rows[0] ?? null;
};

export const findUserById = async (id) => {
  const { rows } = await connect().query(
    `SELECT id, email, password_hash, account_id, verified_at, created, last_login
       FROM web.users WHERE id = $1`,
    [Number(id)]
  );
  return rows[0] ?? null;
};

export const findUserByAccountId = async (accountId) => {
  const { rows } = await connect().query(
    `SELECT id, email, password_hash, account_id, verified_at, created, last_login
       FROM web.users WHERE account_id = $1`,
    [Number(accountId)]
  );
  return rows[0] ?? null;
};

export const linkAccount = async (userId, accountId) => {
  await connect().query("UPDATE web.users SET account_id = $2 WHERE id = $1", [
    Number(userId),
    Number(accountId),
  ]);
};

export const deleteUser = async (id) => {
  await connect().query("DELETE FROM web.users WHERE id = $1", [Number(id)]);
};

export const touchLogin = async (id) => {
  await connect().query("UPDATE web.users SET last_login = now() WHERE id = $1", [Number(id)]);
};

export const setSession = async (id, { data, expires, userId = null }) => {
  await connect().query(
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
  const { rows } = await connect().query(
    "SELECT data FROM web.sessions WHERE id = $1 AND expires > now()",
    [id]
  );
  return rows[0]?.data ?? null;
};

export const destroySession = async (id) => {
  await connect().query("DELETE FROM web.sessions WHERE id = $1", [id]);
};

export const destroyUserSessions = async (userId) => {
  await connect().query("DELETE FROM web.sessions WHERE user_id = $1", [Number(userId)]);
};

/** Also clears whatever has run out, since something has to and this runs often enough. */
export const sweepExpiredSessions = async () => {
  const { rowCount } = await connect().query("DELETE FROM web.sessions WHERE expires <= now()");
  return rowCount;
};

export const markVerified = async (id) => {
  await connect().query("UPDATE web.users SET verified_at = now() WHERE id = $1", [Number(id)]);
};

export const createToken = async ({ userId, tokenHash, purpose, expires }) => {
  await connect().query(
    "INSERT INTO web.tokens (token_hash, user_id, purpose, expires) VALUES ($1, $2, $3, $4)",
    [tokenHash, Number(userId), purpose, expires]
  );
};

/**
 * Expiry and purpose are both in the query. A row that has run out must not be
 * honoured while it is still sitting in the table, and a confirmation link must
 * not be spendable on the password route.
 */
export const findToken = async (tokenHash, purpose) => {
  const { rows } = await connect().query(
    `SELECT user_id FROM web.tokens
      WHERE token_hash = $1 AND purpose = $2 AND expires > now()`,
    [tokenHash, purpose]
  );
  return rows[0] ? { userId: rows[0].user_id } : null;
};

export const consumeToken = async (tokenHash) => {
  await connect().query("DELETE FROM web.tokens WHERE token_hash = $1", [tokenHash]);
};

/** Asking for a new link retires the earlier ones, so an old mail stops working. */
export const deleteUserTokens = async (userId, purpose) => {
  await connect().query("DELETE FROM web.tokens WHERE user_id = $1 AND purpose = $2", [
    Number(userId),
    purpose,
  ]);
};

export const setPassword = async (id, passwordHash) => {
  await connect().query("UPDATE web.users SET password_hash = $2 WHERE id = $1", [
    Number(id),
    passwordHash,
  ]);
};

/* ------------------------------------------------------------------ trades - */

/**
 * A trade and both its offers, assembled the way the rest of the application
 * expects it: one object with the sides keyed by user id.
 */
const withOffers = async (row) => {
  if (!row) return null;
  const { rows } = await connect().query(
    "SELECT user_id, items, gold, accepted FROM web.trade_offers WHERE trade_id = $1",
    [row.id]
  );
  return {
    ...row,
    offers: Object.fromEntries(
      rows.map((offer) => [
        Number(offer.user_id),
        { items: offer.items ?? [], gold: Number(offer.gold), accepted: offer.accepted },
      ])
    ),
  };
};

export const createTrade = async ({ proposerId, partnerId }) => {
  const client = await connect().connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "INSERT INTO web.trades (proposer_id, partner_id) VALUES ($1, $2) RETURNING *",
      [Number(proposerId), Number(partnerId)]
    );
    for (const userId of [proposerId, partnerId]) {
      await client.query(
        "INSERT INTO web.trade_offers (trade_id, user_id) VALUES ($1, $2)",
        [rows[0].id, Number(userId)]
      );
    }
    await client.query("COMMIT");
    return withOffers(rows[0]);
  } catch (problem) {
    await client.query("ROLLBACK");
    throw problem;
  } finally {
    client.release();
  }
};

export const findTrade = async (id) => {
  const { rows } = await connect().query("SELECT * FROM web.trades WHERE id = $1", [Number(id)]);
  return withOffers(rows[0] ?? null);
};

export const findOpenTradeBetween = async (first, second) => {
  const { rows } = await connect().query(
    `SELECT * FROM web.trades
      WHERE state = 'open'
        AND ((proposer_id = $1 AND partner_id = $2) OR (proposer_id = $2 AND partner_id = $1))
      LIMIT 1`,
    [Number(first), Number(second)]
  );
  return withOffers(rows[0] ?? null);
};

export const openTradesFor = async (userId) => {
  const { rows } = await connect().query(
    "SELECT * FROM web.trades WHERE state = 'open' AND (proposer_id = $1 OR partner_id = $1)",
    [Number(userId)]
  );
  return Promise.all(rows.map(withOffers));
};

/**
 * Setting an offer clears both agreements, in the same statement pair, so that
 * there is no instant in which one side's acceptance stands against an offer
 * it never saw.
 */
export const setTradeOffer = async (tradeId, userId, { items, gold }) => {
  const client = await connect().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE web.trade_offers SET items = $3, gold = $4, accepted = false
        WHERE trade_id = $1 AND user_id = $2`,
      [Number(tradeId), Number(userId), JSON.stringify(items), Number(gold)]
    );
    await client.query("UPDATE web.trade_offers SET accepted = false WHERE trade_id = $1", [
      Number(tradeId),
    ]);
    await client.query("COMMIT");
  } catch (problem) {
    await client.query("ROLLBACK");
    throw problem;
  } finally {
    client.release();
  }
  return findTrade(tradeId);
};

export const setTradeAccepted = async (tradeId, userId, accepted) => {
  await connect().query(
    "UPDATE web.trade_offers SET accepted = $3 WHERE trade_id = $1 AND user_id = $2",
    [Number(tradeId), Number(userId), Boolean(accepted)]
  );
  return findTrade(tradeId);
};

export const closeTrade = async (tradeId, state) => {
  await connect().query("UPDATE web.trades SET state = $2, closed = now() WHERE id = $1", [
    Number(tradeId),
    state,
  ]);
  return findTrade(tradeId);
};

export const ping = async () => {
  await connect().query("SELECT 1");
};

export const close = async () => {
  await pool?.end();
  pool = null;
};
