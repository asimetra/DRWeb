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

export const loadConfig = (environment = process.env) => ({
  host: environment.ODW_HOST ?? "127.0.0.1",
  port: asInt(environment.ODW_PORT, 3000),

  /**
   * `memory` keeps everything in the process and loses it on restart. That is
   * right for the tests and for trying the thing out without a database, and
   * wrong for anything else, so it is not the default.
   */
  storage: environment.ODW_STORAGE ?? "postgres",
  databaseUrl: environment.ODW_DATABASE_URL ?? "postgres://ods:ods@127.0.0.1:5432/open_dungeon",

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

  /**
   * Where this site answers from, as somebody clicking a link in their mail
   * would reach it. It cannot be worked out from the request that asked for
   * the mail — a `Host` header is whatever the client sent, and building a
   * verification link out of it is how one account's link gets sent pointing
   * at somebody else's server.
   */
  publicUrl: (environment.ODW_PUBLIC_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),

  /**
   * Long enough to survive a mail sitting unread overnight, short enough that
   * a link found in an old inbox is not still a way in.
   */
  verificationTtlMs: asInt(environment.ODW_VERIFICATION_TTL_MS, 24 * 60 * 60 * 1000),

  /**
   * Unset writes the link to the log instead of sending it, which is how this
   * runs in development without a mail server. It is not a fallback anybody
   * should reach in production, so startup says so plainly.
   */
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
  }
  if (!["postgres", "memory"].includes(settings.storage)) {
    problems.push(`ODW_STORAGE must be "postgres" or "memory", not "${settings.storage}"`);
  }
  return problems;
};
