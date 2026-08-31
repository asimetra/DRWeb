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

export const ping = async () => {
  await connect().query("SELECT 1");
};

export const close = async () => {
  await pool?.end();
  pool = null;
};
