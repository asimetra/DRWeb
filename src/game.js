import { config } from "./config.js";

/**
 * The game server's internal API, from this side.
 *
 * Every account fact this application needs to *change* goes through here
 * rather than through SQL. The game server keeps the accounts that are in play
 * as live objects and orders its writers with locks that are local to that
 * process, so a second process writing the same rows is outside both: a sale
 * settled here while its owner is in a dungeon would be undone by the save at
 * the end of their run. Reading is a different matter — a profile page can
 * query the tables directly and get a consistent snapshot.
 */

export class GameServerError extends Error {
  constructor(status, message, options) {
    super(message, options);
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
      signal: AbortSignal.timeout(config.gameRequestTimeoutMs),
    });
  } catch (problem) {
    // Unreachable is its own answer: the game server being down is not the
    // caller's mistake, and telling them it was would send them to reset a
    // password that is fine.
    const timedOut = problem?.name === "TimeoutError" || problem?.name === "AbortError";
    throw new GameServerError(
      timedOut ? 504 : 503,
      timedOut ? "game server timed out" : "game server unavailable",
      { cause: problem }
    );
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

/**
 * Whether a name is free, so a sign-up form can say so while somebody types.
 *
 * Advice rather than a reservation — the game server settles it when the
 * account is actually made — and the shape rules come back from there too, so
 * there is one definition of what a name may be rather than one here and one
 * there that drift apart.
 */
export const checkName = (name) =>
  call("GET", `/internal/v1/names/${encodeURIComponent(name)}`);

export const readAccount = (accountId) =>
  call("GET", `/internal/v1/accounts/${Number(accountId)}`);

/** The player as a page draws them: name, hero, title, trophies, standings. */
export const readSummary = (accountId) =>
  call("GET", `/internal/v1/accounts/${Number(accountId)}/summary`);

/** What an account could put up for sale, named and already filtered. */
export const readInventory = (accountId) =>
  call("GET", `/internal/v1/accounts/${Number(accountId)}/inventory`);

export const reissueToken = (accountId) =>
  call("POST", `/internal/v1/accounts/${Number(accountId)}/token`);

export const revokeTokens = (accountId) =>
  call("DELETE", `/internal/v1/accounts/${Number(accountId)}/token`);

/** How the server is doing, for the margins of every page. */
export const readStatus = () => call("GET", "/internal/v1/status");

/**
 * The market.
 *
 * All of it is the game server's, because all of it is game state: a listed
 * weapon has left a bag and a sale moves gold between accounts. This
 * application owns who is asking and nothing else — which is why every one of
 * these takes its account id from the caller, and the caller takes it from the
 * session rather than from the request.
 */
export const readMarket = (options = {}) => {
  const query = new URLSearchParams(
    Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
  return call("GET", `/internal/v1/market?${query}`);
};

/**
 * Somebody's profile, by name. Names are unique and the account id is the
 * number the client authenticates with, so this is the one address a profile
 * can be linked by without handing out a credential.
 */
export const readProfile = (name) =>
  call("GET", `/internal/v1/players/${encodeURIComponent(name)}`);

export const readStall = (accountId) =>
  call("GET", `/internal/v1/accounts/${Number(accountId)}/stall`);

export const listForSale = (sellerId, itemId, price) =>
  call("POST", "/internal/v1/market", {
    sellerId: Number(sellerId),
    itemId: Number(itemId),
    price: Number(price),
  });

export const buyListing = (listingId, buyerId) =>
  call("POST", `/internal/v1/market/${Number(listingId)}/buy`, { buyerId: Number(buyerId) });

export const cancelListing = (listingId, sellerId) =>
  call("POST", `/internal/v1/market/${Number(listingId)}/cancel`, { sellerId: Number(sellerId) });

export const claimProceeds = (accountId) =>
  call("POST", `/internal/v1/accounts/${Number(accountId)}/stall/claim`);

/**
 * A standings table. `scope` carries the node, hero and party size that the
 * speedrun board needs and the player-scoped boards ignore.
 */
export const readBoard = (metric, scope = {}) => {
  const query = new URLSearchParams(
    Object.entries(scope).filter(([, value]) => value !== undefined && value !== null)
  );
  const suffix = query.toString();
  return call("GET", `/internal/v1/leaderboards/${encodeURIComponent(metric)}${suffix ? `?${suffix}` : ""}`);
};
