/**
 * Deployment settings, from the environment.
 *
 * `ODW_*` for this application, alongside the game server's `ODS_*`. The three
 * that have no safe default — the session secret, the internal-API token and
 * the database — are read here and checked at startup rather than at the
 * moment they are first needed, so a misconfigured deployment fails on the
 * line that starts it instead of on somebody's first sign-up.
 */

const asInt = (value, fallback) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const loopbackUrl = (value) => {
  try {
    const { hostname } = new URL(value);
    return hostname === "localhost" || hostname === "::1" || hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
};

const loopbackHost = (host) =>
  host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);

export const loadConfig = (environment = process.env) => ({
  production: environment.NODE_ENV === "production",
  host: environment.ODW_HOST ?? "127.0.0.1",
  port: asInt(environment.ODW_PORT, 3000),

  /** Trust forwarded client addresses only behind an explicitly configured proxy. */
  trustProxy: environment.ODW_TRUST_PROXY === "1",
  allowInsecureRemote: environment.ODW_ALLOW_INSECURE_REMOTE === "1",

  /**
   * `memory` keeps everything in the process and loses it on restart. That is
   * right for the tests and for trying the thing out without a database, and
   * wrong for anything else, so it is not the default.
   */
  storage: environment.ODW_STORAGE ?? "postgres",
  databaseUrl: environment.ODW_DATABASE_URL ?? "postgres://ods:ods@127.0.0.1:5432/open_dungeon",
  databaseConfigured: Boolean(environment.ODW_DATABASE_URL),

  /** Signs the session cookie. Rotating it signs everybody out, which is the point. */
  sessionSecret: environment.ODW_SESSION_SECRET ?? "",

  /**
   * Off in development because the cookie would otherwise never be sent over
   * plain HTTP and nothing would work, on everywhere else because a session
   * cookie travelling in clear is a session anybody on the path can take.
   */
  cookieSecure: environment.ODW_COOKIE_SECURE === undefined
    ? environment.NODE_ENV === "production"
    : environment.ODW_COOKIE_SECURE === "1",

  sessionTtlMs: asInt(environment.ODW_SESSION_TTL_MS, 14 * 24 * 60 * 60 * 1000),

  /**
   * The game server's internal API — see DRServer's README. This process never
   * writes an account table; it asks that server to, because the account
   * objects in play there live in memory and its locks are local to it.
   */
  gameInternalUrl: (environment.ODW_GAME_INTERNAL_URL ?? "http://127.0.0.1:8081").replace(/\/$/, ""),
  gameInternalToken: environment.ODW_GAME_INTERNAL_TOKEN ?? "",
  gameRequestTimeoutMs: Math.max(
    250,
    Math.min(30_000, asInt(environment.ODW_GAME_REQUEST_TIMEOUT_MS, 5000))
  ),
  allowInsecureGameInternal: environment.ODW_ALLOW_INSECURE_GAME_INTERNAL === "1",

  /**
   * Where this site answers from, as somebody clicking a link in their mail
   * would reach it. It cannot be worked out from the request that asked for
   * the mail — a `Host` header is whatever the client sent, and building a
   * verification link out of it is how one account's link gets sent pointing
   * at somebody else's server.
   */
  publicUrl: (environment.ODW_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),

  /**
   * How long a mailed link lasts — confirmations and password resets alike.
   * Long enough to survive a mail sitting unread overnight, short enough that
   * a link found in an old inbox is not still a way in.
   */
  linkTtlMs: asInt(environment.ODW_LINK_TTL_MS, 24 * 60 * 60 * 1000),

  /**
   * Unset writes the link to the log instead of sending it, which is how this
   * runs in development without a mail server. It is not a fallback anybody
   * should reach in production, so startup says so plainly.
   */
  /**
   * What to tell a visitor to put in their client configuration. Display only
   * — this application never connects to it — and separate from
   * `gameInternalUrl`, which is a private address a player must never see.
   */
  gameAddress: environment.ODW_GAME_ADDRESS ?? "http://127.0.0.1:8080",

  smtpUrl: environment.ODW_SMTP_URL ?? "",
  mailFrom: environment.ODW_MAIL_FROM ?? "no-reply@localhost",
});

export const config = loadConfig();

/** What is missing, named, or an empty list when nothing is. */
export const configProblems = (settings = config) => {
  const problems = [];
  if (!settings.sessionSecret) {
    problems.push("ODW_SESSION_SECRET is unset");
  } else if (settings.sessionSecret.length < 32) {
    problems.push("ODW_SESSION_SECRET must be at least 32 characters");
  }
  if (!settings.gameInternalToken) {
    problems.push("ODW_GAME_INTERNAL_TOKEN is unset — it must match the game server's ODS_INTERNAL_TOKEN");
  } else if (settings.gameInternalToken.length < 32) {
    problems.push("ODW_GAME_INTERNAL_TOKEN must be at least 32 characters");
  }
  if (!["postgres", "memory"].includes(settings.storage)) {
    problems.push(`ODW_STORAGE must be "postgres" or "memory", not "${settings.storage}"`);
  }
  if (!loopbackHost(settings.host) && !settings.cookieSecure && !settings.allowInsecureRemote) {
    problems.push(
      "refusing an insecure non-loopback web bind — use HTTPS/secure cookies or set " +
        "ODW_ALLOW_INSECURE_REMOTE=1 for a trusted development network"
    );
  }

  let internalUrl;
  try {
    internalUrl = new URL(settings.gameInternalUrl);
    if (!["http:", "https:"].includes(internalUrl.protocol)) throw new Error("unsupported protocol");
  } catch {
    problems.push("ODW_GAME_INTERNAL_URL must be an http(s) URL");
  }
  if (
    internalUrl?.protocol === "http:" &&
    !loopbackUrl(settings.gameInternalUrl) &&
    !settings.allowInsecureGameInternal
  ) {
    problems.push(
      "ODW_GAME_INTERNAL_URL is cleartext and non-loopback — use HTTPS/a tunnel or set " +
        "ODW_ALLOW_INSECURE_GAME_INTERNAL=1 for a trusted private network"
    );
  }

  let publicUrl;
  try {
    publicUrl = new URL(settings.publicUrl);
    if (!["http:", "https:"].includes(publicUrl.protocol)) throw new Error("unsupported protocol");
  } catch {
    problems.push("ODW_PUBLIC_URL must be an http(s) URL");
  }

  if (settings.production) {
    if (!settings.cookieSecure) problems.push("production requires secure session cookies");
    if (publicUrl?.protocol !== "https:") {
      problems.push("ODW_PUBLIC_URL must use HTTPS in production");
    }
    if (!settings.smtpUrl) problems.push("ODW_SMTP_URL is required in production");
    if (settings.storage === "memory") problems.push("ODW_STORAGE=memory is not allowed in production");
    if (settings.storage === "postgres" && !settings.databaseConfigured) {
      problems.push("ODW_DATABASE_URL must be set explicitly in production");
    }
  }
  return problems;
};
