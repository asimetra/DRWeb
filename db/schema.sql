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
 * Single-use links sent to an address: confirming a sign-up, and resetting a
 * password. One table with a purpose rather than two identical ones, because
 * everything about them is the same — minted at 32 random bytes, held as a
 * digest, spent on use, expired on a clock.
 *
 * The digest and not the token, because anybody reading this table would
 * otherwise hold a working link for every address currently waiting on one.
 * A plain SHA-256 is enough where a password needs argon2: a slow hash exists
 * to defend a small set of likely values, and 32 random bytes are not that.
 *
 * `purpose` is checked on redemption as well as looked up, so a confirmation
 * link cannot be posted to the password route and spent there.
 */
CREATE TABLE IF NOT EXISTS web.tokens (
    token_hash TEXT        PRIMARY KEY,
    user_id    BIGINT      NOT NULL REFERENCES web.users(id) ON DELETE CASCADE,
    purpose    TEXT        NOT NULL CHECK (purpose IN ('verify', 'reset')),
    expires    TIMESTAMPTZ NOT NULL,
    created    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tokens_user ON web.tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS tokens_expires ON web.tokens(expires);

/*
 * Trades, which are a conversation before they are a movement of goods.
 *
 * Every part of the negotiation lives here — who proposed it, what each side
 * is offering, who has agreed — because none of it is game state. The moment
 * both sides have agreed, the game server is asked to move the goods on one
 * transaction, and this table remembers only that it happened.
 *
 * `state` is checked rather than inferred. A settled trade must not be
 * reopened by a late click, and a cancelled one must not settle.
 */
CREATE TABLE IF NOT EXISTS web.trades (
    id          BIGSERIAL   PRIMARY KEY,
    proposer_id BIGINT      NOT NULL REFERENCES web.users(id) ON DELETE CASCADE,
    partner_id  BIGINT      NOT NULL REFERENCES web.users(id) ON DELETE CASCADE,
    state       TEXT        NOT NULL DEFAULT 'open'
                            CHECK (state IN ('open', 'settled', 'cancelled')),
    created     TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed      TIMESTAMPTZ,
    CHECK (proposer_id <> partner_id)
);

CREATE INDEX IF NOT EXISTS trades_proposer ON web.trades(proposer_id) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS trades_partner ON web.trades(partner_id) WHERE state = 'open';

/*
 * One row per side. `accepted` is cleared on both rows whenever either offer
 * changes — the oldest rule a trade window has, and the one that stops the
 * swap made in the moment between the other person agreeing and the goods
 * moving.
 *
 * `items` holds game item ids and nothing else. Their power, rarity and name
 * are read from the game server when the screen is drawn, because this table
 * must not be a second opinion about what a weapon is.
 */
CREATE TABLE IF NOT EXISTS web.trade_offers (
    trade_id BIGINT  NOT NULL REFERENCES web.trades(id) ON DELETE CASCADE,
    user_id  BIGINT  NOT NULL REFERENCES web.users(id) ON DELETE CASCADE,
    items    JSONB   NOT NULL DEFAULT '[]',
    gold     BIGINT  NOT NULL DEFAULT 0 CHECK (gold >= 0),
    accepted BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (trade_id, user_id)
);
