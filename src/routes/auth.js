import * as storage from "../storage/index.js";
import { config } from "../config.js";
import { PURPOSE, digestOf, mintToken } from "../tokens.js";
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

/**
 * Mints a link, retires the ones before it, and sends it.
 *
 * Retiring first is what makes "I asked again" mean the earlier mail stops
 * working — otherwise every link ever sent stays live until it expires, and a
 * password reset is only as strong as the oldest mail in the inbox.
 */
const sendLink = async (app, user, purpose) => {
  await storage.deleteUserTokens(user.id, purpose);
  const token = mintToken();
  await storage.createToken({
    userId: user.id,
    tokenHash: digestOf(token),
    purpose,
    expires: new Date(Date.now() + config.linkTtlMs),
  });

  if (purpose === PURPOSE.VERIFY) await app.mailer.sendVerification(user.email, token);
  else await app.mailer.sendPasswordReset(user.email, token);
};

/** The user a link names, or null — the caller answers the same way for both. */
const redeem = async (token, purpose) => {
  if (typeof token !== "string" || !token) return null;
  const hash = digestOf(token);
  const found = await storage.findToken(hash, purpose);
  if (!found) return null;

  const user = await storage.findUserById(found.userId);
  if (!user) {
    await storage.consumeToken(hash);
    return null;
  }
  return { user, hash };
};

const BAD_LINK = "that link is not valid, or has expired";

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
    return reply
      .code(409)
      .send({ error: "confirm your email address first — no game account exists yet" });
  }
};

export const authRoutes = async (app) => {
  /**
   * The token the browser must echo on every state-changing call. Asking for
   * it is what starts a session, so the sign-up form has one to carry.
   */
  app.get("/api/csrf", async (request, reply) => ({ csrfToken: reply.generateCsrf() }));

  /**
   * Whether a name may be had, for a sign-up form to say so as it is typed.
   *
   * Passed straight through: both the rules and the answer are the game
   * server's, so this side holds no second opinion about what a name is. Rate
   * limited because it answers a question about other people's names and an
   * unlimited one is a way to walk the roster.
   */
  app.get(
    "/api/names/:name",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      try {
        return await app.game.checkName(request.params.name);
      } catch (failure) {
        if (!(failure instanceof GameServerError)) throw failure;
        return reply.code(502).send({ error: "the game server is not answering" });
      }
    }
  );

  /**
   * Registering, which now creates a user and nothing else.
   *
   * The game account waits until the address has been proved. Minting it here
   * would mean an account, a hero and a working token for every address
   * somebody cares to type, including addresses belonging to other people.
   * Nothing exists to be cleaned up if the mail is never opened.
   *
   * The user row still goes in first and on its own, because the unique index
   * on the address is the only thing that can settle a race between two
   * sign-ups and it can only settle it by being written to.
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

      /*
       * The name is settled here so somebody hears "that one is taken" at the
       * form rather than after a round trip through their email — but what a
       * name may be, and whether this one is free, are both the game server's
       * answer. Asking it keeps one definition of a name instead of a copy here
       * that drifts away from it.
       *
       * It is advice, not a reservation. Between now and confirming, somebody
       * else may take it; the game server refuses then and /api/verify asks for
       * another.
       */
      let wantedName;
      try {
        const verdict = await app.game.checkName(name ?? "");
        if (!verdict.free) {
          return reply
            .code(409)
            .send({ error: verdict.error ?? "that name is taken", reason: verdict.reason });
        }
        wantedName = verdict.name;
      } catch (failure) {
        if (!(failure instanceof GameServerError)) throw failure;
        request.log.error(`register: could not check a name: ${failure.message}`);
        return reply.code(502).send({ error: "the game server is not answering" });
      }

      let user;
      try {
        user = await storage.createUser({
          email,
          passwordHash: await hashPassword(password),
          wantedName,
        });
      } catch (failure) {
        if (failure instanceof EmailTaken) {
          return reply.code(409).send({ error: "an account already exists for that address" });
        }
        throw failure;
      }

      await sendLink(app, user, PURPOSE.VERIFY);
      request.session.userId = user.id;

      request.log.info(`registered ${user.email}, awaiting confirmation`);
      return reply.code(201).send({ user: publicUser(user), verificationRequired: true });
    }
  );

  /**
   * Proving the address, which is also when the game account is made.
   *
   * The order is: mint, link, mark, spend the token. A failure part way
   * through leaves a game account nobody holds a token for, which costs a row
   * and nothing else, and leaves the link still working so its owner can
   * finish. Spending the token first would do the opposite — a game server
   * hiccup would burn somebody's only link.
   */
  app.post(
    "/api/verify",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 20, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const redeemed = await redeem(request.body?.token, PURPOSE.VERIFY);
      if (!redeemed) return reply.code(400).send({ error: BAD_LINK });
      const { user, hash } = redeemed;

      // Already done, and the link clicked twice. Not an error worth showing.
      if (user.account_id) {
        await storage.consumeToken(hash);
        return { user: publicUser(user), game: null };
      }

      /*
       * The name chosen at sign-up, unless this request carries a replacement.
       *
       * A replacement is how the collision below is recovered from: the name
       * was free when it was asked for and somebody took it in the meantime, so
       * the confirmation page asks for another and posts the same link again.
       */
      let account;
      try {
        account = await app.game.registerAccount({
          name: request.body?.name?.trim() || user.wanted_name || undefined,
        });
      } catch (failure) {
        if (!(failure instanceof GameServerError)) throw failure;
        /*
         * A refused name is the one failure here the player can do something
         * about, so it is not flattened into "the game server could not". The
         * link is deliberately left unspent — they need it to try again.
         */
        if (failure.status === 409) {
          request.log.info(`verify: name refused — ${failure.message}`);
          return reply.code(409).send({ error: failure.message, reason: "name" });
        }
        request.log.error(`verify: game server refused: ${failure.message}`);
        return reply.code(502).send({ error: "the game server could not create an account" });
      }

      await storage.linkAccount(user.id, account.accountId);
      await storage.markVerified(user.id);
      await storage.consumeToken(hash);

      // Confirming is proof enough to be signed in; the link may well have
      // been opened somewhere the sign-up session never reached.
      await request.session.regenerate();
      request.session.userId = user.id;

      request.log.info(`confirmed ${user.email} as game account ${account.accountId}`);
      return {
        user: { ...publicUser(user), accountId: account.accountId, verified: true },
        /**
         * Returned once, here, because this is the moment the player has to
         * copy it into their client. Every later look costs a fresh one.
         */
        game: { accountId: account.accountId, token: account.token, expires: account.expires },
      };
    }
  );

  /**
   * Another link, for a mail that never arrived.
   *
   * Answers the same either way. Told apart, this would be a way to ask which
   * addresses have signed up here — which is exactly what the single answer on
   * the sign-in route below exists to prevent.
   */
  app.post(
    "/api/verify/resend",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 3, timeWindow: "10 minutes" } },
    },
    async (request) => {
      const { email } = request.body ?? {};
      if (typeof email === "string" && !emailProblem(email)) {
        const user = await storage.findUserByEmail(email);
        if (user && !user.account_id) await sendLink(app, user, PURPOSE.VERIFY);
      }
      return { ok: true };
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

  /**
   * Asking for a reset link. Answers the same whether or not the address is
   * one this server has heard of, for the reason the sign-in route gives.
   */
  app.post(
    "/api/password/forgot",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 3, timeWindow: "10 minutes" } },
    },
    async (request) => {
      const { email } = request.body ?? {};
      if (typeof email === "string" && !emailProblem(email)) {
        const user = await storage.findUserByEmail(email);
        if (user) {
          await sendLink(app, user, PURPOSE.RESET);
          request.log.info(`sent a reset link to user ${user.id}`);
        }
      }
      return { ok: true };
    }
  );

  /**
   * Choosing a new password, and taking the account back with it.
   *
   * A reset is what somebody does when they think another person has been in
   * their account, so changing the password is the least of it. Two things
   * have to go with it or the reset does not actually recover anything:
   *
   *   - every web session ends, including the intruder's;
   *   - every game token is revoked. `POST /api/game-token` hands out a
   *     credential good for most of a year, so anybody who reached the account
   *     could have taken one, and it would outlive the password by months.
   *
   * The revocation goes first. If the game server cannot be reached, nothing
   * here changes and the link stays usable — better than a password that has
   * moved on while the old client token still plays.
   */
  app.post(
    "/api/password/reset",
    {
      onRequest: app.csrfProtection,
      config: { rateLimit: { max: 10, timeWindow: "10 minutes" } },
    },
    async (request, reply) => {
      const problem = passwordProblem(request.body?.password);
      if (problem) return reply.code(400).send({ error: problem });

      const redeemed = await redeem(request.body?.token, PURPOSE.RESET);
      if (!redeemed) return reply.code(400).send({ error: BAD_LINK });
      const { user, hash } = redeemed;

      if (user.account_id) {
        try {
          await app.game.revokeTokens(user.account_id);
        } catch (failure) {
          if (failure instanceof GameServerError) {
            request.log.error(`reset: could not revoke game tokens: ${failure.message}`);
            return reply
              .code(502)
              .send({ error: "the game server could not be reached — nothing was changed" });
          }
          throw failure;
        }
      }

      await storage.setPassword(user.id, await hashPassword(request.body.password));
      await storage.destroyUserSessions(user.id);
      await storage.consumeToken(hash);

      /**
       * A replacement client token, because the one in their configuration
       * file has just stopped working and this is where they are standing. A
       * failure here is not worth undoing the reset over — `/api/game-token`
       * offers the same thing.
       */
      let game = null;
      if (user.account_id) {
        try {
          const issued = await app.game.reissueToken(user.account_id);
          game = { accountId: issued.accountId, token: issued.token, expires: issued.expires };
        } catch (failure) {
          if (!(failure instanceof GameServerError)) throw failure;
          request.log.error(`reset: could not issue a replacement token: ${failure.message}`);
        }
      }

      await request.session.regenerate();
      request.session.userId = user.id;

      request.log.info(`reset the password for user ${user.id}`);
      return { user: publicUser(user), game };
    }
  );

  /**
   * Changing a password you already know, which is a different situation.
   *
   * Knowing the current one means nothing is claimed to be compromised, so the
   * game client is left alone — signing somebody out of the game for tidying
   * up their password would be a surprise. Other web sessions still end, since
   * that is the one thing a password change is expected to do.
   */
  app.post(
    "/api/password",
    {
      onRequest: [requireSession, app.csrfProtection],
      config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body ?? {};
      const problem = passwordProblem(newPassword);
      if (problem) return reply.code(400).send({ error: problem });

      if (typeof currentPassword !== "string" ||
          !(await checkPassword(currentPassword, request.user.password_hash))) {
        request.log.warn(`password change refused for user ${request.user.id}`);
        return reply.code(401).send({ error: "wrong password" });
      }

      await storage.setPassword(request.user.id, await hashPassword(newPassword));
      await storage.destroyUserSessions(request.user.id);

      // Ended along with the rest, then started again here: the person who
      // just proved the old password keeps the browser they did it in.
      await request.session.regenerate();
      request.session.userId = request.user.id;

      request.log.info(`changed the password for user ${request.user.id}`);
      return { ok: true };
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
   * The signed-in player's character, for the panel in the margin.
   *
   * Assembled by the game server rather than here: the title ladder, the level
   * and the standings are all its rules, and working them out a second time on
   * this side would be a second opinion to keep in step.
   *
   * A game server that is not answering is not an error. Somebody signed in on
   * the website while the game restarts should see their account page, not a
   * failure — so the panel goes quiet and everything else stands.
   */
  app.get("/api/me/character", { onRequest: requireAccount }, async (request) => {
    try {
      return await app.game.readSummary(request.user.accountId);
    } catch (problem) {
      if (problem instanceof GameServerError) return { reachable: false };
      throw problem;
    }
  });

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
