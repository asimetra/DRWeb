/**
 * Talking to the API, with the CSRF token handled once here rather than at
 * every call site.
 *
 * Signing in, confirming an address and resetting a password all regenerate
 * the session, and the CSRF secret lives in the session — so the token held
 * here goes stale at exactly those three moments. Rather than remember to
 * clear it at each of them, a refusal is taken as the signal: fetch a fresh
 * token and try the call once more.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let cached = null;

const token = async () => {
  if (cached) return cached;
  const response = await fetch("/api/csrf", { credentials: "same-origin" });
  if (!response.ok) throw new ApiError(response.status, "could not reach the server");
  cached = (await response.json()).csrfToken;
  return cached;
};

const attempt = async (method, path, body) => {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = await token();

  const response = await fetch(path, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return { response, data };
};

const call = async (method, path, body) => {
  let { response, data } = await attempt(method, path, body);

  if (response.status === 403 && method !== "GET") {
    cached = null;
    ({ response, data } = await attempt(method, path, body));
  }

  if (!response.ok) {
    throw new ApiError(response.status, data.error ?? `the server answered ${response.status}`);
  }
  return data;
};

export const api = {
  me: () => call("GET", "/api/me"),
  register: (body) => call("POST", "/api/register", body),
  /** Whether a character name may be had. The rules are the game server's. */
  checkName: (name) => call("GET", `/api/names/${encodeURIComponent(name)}`),
  verify: (token) => call("POST", "/api/verify", { token }),
  resendVerification: (email) => call("POST", "/api/verify/resend", { email }),
  login: (body) => call("POST", "/api/login", body),
  logout: () => call("POST", "/api/logout"),
  forgotPassword: (email) => call("POST", "/api/password/forgot", { email }),
  resetPassword: (body) => call("POST", "/api/password/reset", body),
  changePassword: (body) => call("POST", "/api/password", body),
  newGameToken: () => call("POST", "/api/game-token"),

  server: () => call("GET", "/api/server"),
  /*
   * The margins. These went through `attempt` so that a game server that is
   * down could not throw the page away — but `attempt` answers with the
   * envelope, so every field a margin read came back undefined and the boxes
   * quietly drew zeros. `/api/status` was reporting a run today and forty
   * minutes of uptime while the panel said none and 0m.
   *
   * A refusal is a rejection, which is what the panels already handle: they
   * catch it and say the server is not answering.
   */
  character: () => call("GET", "/api/me/character"),
  status: () => call("GET", "/api/status"),

  leaderboard: (metric, scope = {}) => {
    const query = new URLSearchParams(
      Object.entries(scope).filter(([, value]) => value !== undefined && value !== null)
    );
    return call("GET", `/api/leaderboards/${metric}?${query}`);
  },
  inventory: () => call("GET", "/api/inventory"),

  /*
   * The market. Which account each of these acts on is decided on the server
   * from the session — nothing here sends an account id, because an account id
   * a browser could choose would be a way to sell somebody else's weapons.
   */
  profile: (name) => call("GET", `/api/players/${encodeURIComponent(name)}`),
  market: (options = {}) => {
    const query = new URLSearchParams(
      Object.entries(options).filter(([, value]) => value !== undefined && value !== null && value !== "")
    );
    return call("GET", `/api/market?${query}`);
  },
  stall: () => call("GET", "/api/market/stall"),
  listForSale: (itemId, price) => call("POST", "/api/market", { itemId, price }),
  buyListing: (id) => call("POST", `/api/market/${Number(id)}/buy`),
  cancelListing: (id) => call("POST", `/api/market/${Number(id)}/cancel`),
  claimProceeds: () => call("POST", "/api/market/claim"),

  revokeGameTokens: () => call("DELETE", "/api/game-token"),
};
