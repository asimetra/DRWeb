import { config } from "./config.js";

/**
 * The game server's internal API, from this side.
 *
 * Every account fact this application needs to *change* goes through here
 * rather than through SQL. The game server keeps the accounts that are in play
 * as live objects and orders its writers with locks that are local to that
 * process, so a second process writing the same rows is outside both: a trade
 * settled here while its owner is in a dungeon would be undone by the save at
 * the end of their run. Reading is a different matter — a profile page can
 * query the tables directly and get a consistent snapshot.
 */

export class GameServerError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "GameServerError";
    this.status = status;
  }
}

const call = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${config.gameInternalUrl}${path}`, {
      method,
      headers: {
        "X-Internal-Token": config.gameInternalToken,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (problem) {
    // Unreachable is its own answer: the game server being down is not the
    // caller's mistake, and telling them it was would send them to reset a
    // password that is fine.
    throw new GameServerError(503, `game server unreachable: ${problem.message}`);
  }

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Left null; the status is what matters below.
  }

  if (!response.ok) {
    throw new GameServerError(
      response.status,
      parsed?.error ?? `game server answered ${response.status}`
    );
  }
  return parsed;
};

export const registerAccount = ({ name } = {}) =>
  call("POST", "/internal/v1/accounts", name === undefined ? {} : { name });

export const readAccount = (accountId) =>
  call("GET", `/internal/v1/accounts/${Number(accountId)}`);

export const reissueToken = (accountId) =>
  call("POST", `/internal/v1/accounts/${Number(accountId)}/token`);

export const revokeTokens = (accountId) =>
  call("DELETE", `/internal/v1/accounts/${Number(accountId)}/token`);

/**
 * Both sides have agreed; move the goods. One call because the game server
 * does it as one transaction — the pair locked in id order, both accounts
 * written together — and splitting it would be inventing a way for a weapon
 * to end up on neither account.
 */
export const settleTrade = (parties) => call("POST", "/internal/v1/trades", { parties });
