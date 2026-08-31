import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import session from "@fastify/session";
import csrf from "@fastify/csrf-protection";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import * as storage from "./storage/index.js";
import * as gameServer from "./game.js";
import { createMailer } from "./mail.js";
import { authRoutes } from "./routes/auth.js";
import { publicRoutes } from "./routes/public.js";
import { marketRoutes } from "./routes/market.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, "..", "public");

/**
 * Sessions live in whichever backend the configuration named.
 *
 * `@fastify/session` hands the whole session object over and takes it back,
 * and its cookie carries an expiry that has to survive the round trip. JSON
 * turns a Date into a string on the way out and does not turn it back, so a
 * revived session would otherwise come back with an expiry the cookie code
 * cannot compare and every restored session would look like it had run out.
 */
const sessionStore = {
  set(id, value, callback) {
    const expires = value?.cookie?.expires ?? new Date(Date.now() + config.sessionTtlMs);
    storage
      .setSession(id, {
        data: value,
        expires: new Date(expires),
        userId: value?.userId ?? null,
      })
      .then(() => callback(null), callback);
  },

  get(id, callback) {
    storage.getSession(id).then((data) => {
      if (!data) return callback(null, null);
      if (typeof data.cookie?.expires === "string") {
        data.cookie.expires = new Date(data.cookie.expires);
      }
      callback(null, data);
    }, callback);
  },

  destroy(id, callback) {
    storage.destroySession(id).then(() => callback(null), callback);
  },
};

/**
 * The application, assembled but not listening.
 *
 * `game` is a parameter so the tests can stand in for the game server. They
 * are testing this application's half of registering — that a user row and a
 * game account are created together or not at all — and standing up a second
 * server to prove it would be testing the other repository instead.
 */
export const buildApp = async ({
  game = gameServer,
  mailer = null,
  rateLimited = true,
  logger = false,
} = {}) => {
  const app = Fastify({ logger, trustProxy: true });

  app.decorate("game", game);
  app.decorate("mailer", mailer ?? (await createMailer()));

  await app.register(helmet, {
    // Set once the front end is built and its own sources are known; a policy
    // written before there is anything to allow is a policy nobody can check.
    contentSecurityPolicy: false,
  });

  if (rateLimited) {
    /**
     * A ceiling for everything, with the routes that guess at secrets holding
     * their own much lower ones. This one is only here so that a flood cannot
     * reach the handlers at all.
     */
    await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });
  }

  await app.register(cookie);
  await app.register(session, {
    secret: config.sessionSecret,
    store: sessionStore,
    // A visitor who never signs in leaves no row behind.
    saveUninitialized: false,
    cookieName: "odw.sid",
    cookie: {
      path: "/",
      httpOnly: true,
      secure: config.cookieSecure,
      /**
       * Strict rather than lax: nothing here is meant to be reached by
       * following a link from somewhere else, and the CSRF token below is a
       * second lock rather than a reason to loosen this one.
       */
      sameSite: "strict",
      maxAge: config.sessionTtlMs,
    },
  });
  await app.register(csrf, { sessionPlugin: "@fastify/session" });

  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(marketRoutes);

  /**
   * The built front end, when there is one. Registered conditionally so that a
   * checkout that has not run the build still starts and still serves the API.
   */
  if (fs.existsSync(publicDir)) {
    await app.register(fastifyStatic, { root: publicDir });

    /**
     * The front end owns its own paths, and a confirmation link points at one
     * of them. `/verify?token=…` is a real URL somebody opens from their mail,
     * not a route this server has a handler for, so anything that is not the
     * API and not a file on disk is answered with the application itself and
     * routed once it is running.
     */
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html");
    });
  }

  return app;
};
