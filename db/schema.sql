-- Web front-end storage.
--
-- Its own schema, in the same database as the game. The same database because
-- a web user points at a game account and that reference is worth having the
-- database enforce; its own schema because the game server owns `public` and
-- is the only writer there. Nothing in this file is written by the game
-- server, and nothing in db/schema.sql over in DRServer is written by this one.

CREATE SCHEMA IF NOT EXISTS web;

/*
 * Who signed up, which is a different fact from which game account they play.
 *
 * The client has no login screen: it reads an account id and a validation
 * token out of its own configuration file and presents those. So a web user
 * and a game account are two identities for one person, joined here, and the
 * join is nullable in one direction on purpose — the row is written before the
 * game account exists, so that a second sign-up with the same address is
 * refused by the unique index rather than after an account has been minted for
 * it.
 */
CREATE TABLE IF NOT EXISTS web.users (
    id            BIGSERIAL   PRIMARY KEY,
    email         TEXT        NOT NULL,
    password_hash TEXT        NOT NULL,
    account_id    BIGINT      UNIQUE REFERENCES public.accounts(id) ON DELETE SET NULL,
    verified_at   TIMESTAMPTZ,
    created       TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login    TIMESTAMPTZ
);

-- Addresses differ in case and people do not. Stored as typed, compared folded.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON web.users (lower(email));

/*
 * Server-side sessions, so that signing out actually ends one.
 *
 * A signed cookie carrying the user id would need no table and could not be
 * withdrawn: every copy of it stays valid until it expires, including the one
 * taken off a shared machine. `user_id` is nullable because a session exists
 * before anybody has logged into it — it is what carries the CSRF secret to
 * the sign-up form.
 */
CREATE TABLE IF NOT EXISTS web.sessions (
    id      TEXT        PRIMARY KEY,
    user_id BIGINT      REFERENCES web.users(id) ON DELETE CASCADE,
    data    JSONB       NOT NULL,
    expires TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON web.sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires ON web.sessions(expires);

/*
 * Outstanding "click this to prove the address is yours" links.
 *
 * The token is stored as a digest, not as itself. Anybody reading this table
 * would otherwise hold a working link for every address waiting on one, and
 * these are handed out precisely to people who have not proved anything yet.
 * A plain SHA-256 is enough where a password would need argon2: the token is
 * 32 random bytes, so there is no small set of likely values to work through.
 *
 * One row per outstanding request, deleted when it is used. A resend clears
 * the account's earlier rows, so an old link in an old mail stops working the
 * moment a new one is asked for.
 */
CREATE TABLE IF NOT EXISTS web.email_verifications (
    token_hash TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES web.users(id) ON DELETE CASCADE,
    expires    TIMESTAMPTZ NOT NULL,
    created    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verifications_user ON web.email_verifications(user_id);
