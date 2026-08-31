import * as storage from "../storage/index.js";
import { EmailTaken } from "../storage/errors.js";
import { GameServerError } from "../game.js";
import { checkPassword, hashPassword, passwordProblem } from "../passwords.js";

/**
 * Signing up, signing in, and handing over the credential the game client
 * actually uses.
 *
 * Two identities meet here. The website's is an address and a password; the
 * client's is an account id and a signed token it reads out of its own
 * configuration file, because it has no login screen to type anything into.
 * Registering is what creates the second and ties it to the first.
 */

/**
 * Deliberately loose. An address either receives the confirmation or it does
 * not, and a stricter pattern refuses real addresses long before it catches a
 * fake one.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

const emailProblem = (email) => {
  if (typeof email !== "string") return "email must be a string";
  const trimmed = email.trim();
  if (!trimmed) return "email is required";
  if (trimmed.length > MAX_EMAIL_LENGTH) return "email is too long";
  if (!EMAIL.test(trimmed)) return "that does not look like an email address";
  return null;
};

/** What the browser is allowed to know about the person it is signed in as. */
const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  accountId: user.account_id,
  verified: Boolean(user.verified_at),
});

const requireSession = async (request, reply) => {
  const userId = request.session?.userId;
  if (!userId) return reply.code(401).send({ error: "not signed in" });

  const user = await storage.findUserById(userId);
  if (!user) {
    // The row is gone and the cookie is not; ending it here stops every later
    // handler having to wonder.
    await request.session.destroy();
    return reply.code(401).send({ error: "not signed in" });
  }
  request.user = user;
};

const requireAccount = async (request, reply) => {
  const stopped = await requireSession(request, reply);
  if (stopped) return stopped;
  if (!request.user.account_id) {
    return reply.code(409).send({ error: "this user has no game account yet" });
  }
};

export const authRoutes = async (app) => {
  /**
   * The token the browser must echo on every state-changing call. Asking for
   * it is what starts a session, so the sign-up form has one to carry.
   */
  app.get("/api/csrf", async (request, reply) => ({ csrfToken: reply.generateCsrf() }));

  /**
   * Registering, in an order chosen so that neither half can be orphaned.
   *
   * The user row goes in first, because the unique index on the address is the
   * only thing that can settle a race between two sign-ups and it can only
   * settle it by being written to. Only then is the game account minted. If
   * that fails the row is taken back out, which is recoverable; the other
   * order would leave a game account nobody can reach, which is not.
   */
  app.post(
    "/api/register",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const { email, password, name } = request.body ?? {};
      const problem = emailProblem(email) ?? passwordProblem(password);
      if (problem) return reply.code(400).send({ error: problem });
      if (name !== undefined && (typeof name !== "string" || !name.trim())) {
        return reply.code(400).send({ error: "name must be a non-empty string when given" });
      }

      let user;
      try {
        user = await storage.createUser({
          email,
          passwordHash: await hashPassword(password),
        });
      } catch (failure) {
        if (failure instanceof EmailTaken) {
          return reply.code(409).send({ error: "an account already exists for that address" });
        }
        throw failure;
      }

      let account;
      try {
        account = await app.game.registerAccount({ name: name?.trim() });
      } catch (failure) {
        await storage.deleteUser(user.id);
        if (failure instanceof GameServerError) {
          request.log.error(`register: game server refused: ${failure.message}`);
          return reply.code(502).send({ error: "the game server could not create an account" });
        }
        throw failure;
      }

      await storage.linkAccount(user.id, account.accountId);
      request.session.userId = user.id;

      request.log.info(`registered ${user.email} as game account ${account.accountId}`);
      return reply.code(201).send({
        user: { ...publicUser(user), accountId: account.accountId },
        /**
         * Returned once, here, because this is the moment the player has to
         * copy it into their client. Every later look costs a fresh one.
         */
        game: { accountId: account.accountId, token: account.token, expires: account.expires },
      });
    }
  );

  /**
   * One answer for "no such address" and for "wrong password", because two
   * would turn this into a way to ask whether somebody has an account here.
   */
  app.post(
    "/api/login",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const { email, password } = request.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        return reply.code(400).send({ error: "email and password are required" });
      }

      const user = await storage.findUserByEmail(email);
      const good = user && (await checkPassword(password, user.password_hash));
      if (!good) {
        request.log.warn(`login refused for ${String(email).slice(0, 64)}`);
        return reply.code(401).send({ error: "wrong email or password" });
      }

      /**
       * A new session id for the newly raised privilege, so that a session id
       * an attacker planted before the sign-in is not the one that ends up
       * signed in.
       */
      await request.session.regenerate();
      request.session.userId = user.id;
      await storage.touchLogin(user.id);

      return { user: publicUser(user) };
    }
  );

  app.post("/api/logout", { onRequest: app.csrfProtection }, async (request) => {
    await request.session.destroy();
    return { ok: true };
  });

  app.get("/api/me", { onRequest: requireSession }, async (request) => ({
    user: publicUser(request.user),
  }));

  /**
   * A replacement client token, for somebody who has lost their configuration.
   * It does not invalidate the old one — that is what the DELETE is for.
   */
  app.post(
    "/api/game-token",
    {
      onRequest: [requireAccount, app.csrfProtection],
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request) => {
      const issued = await app.game.reissueToken(request.user.account_id);
      request.log.info(`reissued a game token for account ${request.user.account_id}`);
      return { accountId: issued.accountId, token: issued.token, expires: issued.expires };
    }
  );

  /**
   * Signing the client out everywhere. Separate from signing out of the
   * website, because they are different credentials on different machines and
   * somebody closing a browser tab does not mean to lock their game client.
   */
  app.delete(
    "/api/game-token",
    { onRequest: [requireAccount, app.csrfProtection] },
    async (request) => {
      const result = await app.game.revokeTokens(request.user.account_id);
      request.log.info(`revoked every game token for account ${request.user.account_id}`);
      return { accountId: result.accountId, generation: result.generation };
    }
  );
};
