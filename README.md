# Open Dungeon Web

The web front end for an [Open Dungeon Server](https://github.com/asimetra/DRServer)
deployment: signing up, signing in, and handing a player the credential their
game client actually uses.

Server code only. It is useless on its own — it needs a game server to talk to.

## The division

The game server owns the account tables and is the only thing that writes them.
That is not tidiness. It keeps the accounts that are in play as live objects in
memory and orders its writers with locks that are local to that process, so a
second process writing the same rows sits outside both: a trade settled here
while its owner was in a dungeon would be undone by the save at the end of
their run.

So this application owns its own tables — who signed up, with which address,
holding which session — in a `web` schema in the same database, and asks the
game server for everything else over its internal API.

```
  browser ──▶ this  ──▶ web schema      (users, sessions)
                 │
                 └─▶ game server ──▶ public schema   (accounts, items, …)
                     internal API      ← the only writer
```

Reading is a different matter. A profile page or a leaderboard can query the
account tables directly and get a consistent snapshot; it is only writing that
has to go through the door.

## Requirements

- Node.js 20+
- a running game server with its internal API enabled
- Postgres, sharing the game's database

## Run

The game server needs to be started with an internal token, and this one needs
the same token:

```bash
# in the game server's checkout
ODS_INTERNAL_TOKEN=$(openssl rand -hex 32) npm start
```

```bash
# here
ODW_SESSION_SECRET=$(openssl rand -hex 32) \
ODW_GAME_INTERNAL_TOKEN=<the same token> \
npm start
```

Apply `db/schema.sql` once against the game's database before the first run.

For a look at it without a database, `ODW_STORAGE=memory` keeps everything in
the process and loses it on restart. That is what the tests use, and it is not
the default for the obvious reason.

## The front end

React, built by Vite into `public/`, which the server serves when it is there
and skips when it is not — a checkout that has never run the build still starts
and still answers the API.

```bash
npm run build     # into public/
npm run dev:web   # Vite on 5173, proxying /api to the server on 3000
```

Anything that is not `/api/…` and not a file on disk is answered with
`index.html`, because `/verify?token=…` is a URL somebody opens from their mail
rather than a route the server handles.

The look is cream content boxes on a dark ground, brown rules, Verdana at 13px
— the shape an older game's account pages take. No display face, no webfont, no
ornament: a heading is a bar with a noun in it. The copy matches. Buttons say
what they do and nothing narrates.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `ODW_HOST` / `ODW_PORT` | `127.0.0.1` / `3000` | Bind address |
| `ODW_STORAGE` | `postgres` | `postgres` or `memory` |
| `ODW_DATABASE_URL` | the game's dev database | Where the `web` schema lives |
| `ODW_SESSION_SECRET` | — | Signs the session cookie; at least 32 characters |
| `ODW_SESSION_TTL_MS` | 14 days | How long a signed-in session lasts |
| `ODW_COOKIE_SECURE` | on under `NODE_ENV=production` | Refuse to send the cookie over plain HTTP |
| `ODW_GAME_INTERNAL_URL` | `http://127.0.0.1:8081` | The game server's internal API |
| `ODW_GAME_INTERNAL_TOKEN` | — | Must match the game server's `ODS_INTERNAL_TOKEN` |
| `ODW_PUBLIC_URL` | `http://127.0.0.1:3000` | Where confirmation links point |
| `ODW_LINK_TTL_MS` | 24 hours | How long a mailed link lasts — confirmation and reset alike |
| `ODW_GAME_ADDRESS` | `http://127.0.0.1:8080` | Shown to players for their client configuration |
| `ODW_SMTP_URL` | — | SMTP connection string; unset logs the link instead of sending |
| `ODW_MAIL_FROM` | `no-reply@localhost` | Sender address |

The three without defaults are checked at startup, so a misconfigured
deployment fails on the command that started it rather than on somebody's first
sign-up.

## API

Every state-changing call carries a CSRF token from `GET /api/csrf` as
`X-CSRF-Token`. Signing in regenerates the session, which discards the token
with it — fetch a fresh one afterwards.

| Route | Does |
|---|---|
| `GET /api/server` | The address a player puts in their client. **Open** |
| `GET /api/leaderboards/:metric` | Standings, cached 15s. **Open** |
| `GET /api/csrf` | A CSRF token, and the session that carries it |
| `POST /api/register` | Creates a user and mails a confirmation link. No game account yet |
| `POST /api/verify` | Confirms the address, creates the game account, returns the client token **once** |
| `POST /api/verify/resend` | Another link, retiring the one before it |
| `POST /api/login` | Signs in |
| `POST /api/password/forgot` | Mails a reset link |
| `POST /api/password/reset` | Sets a new password, ends every session, revokes the game token |
| `POST /api/password` | Changes a password you already know |
| `GET /api/inventory` | Your unequipped weapons and gold |
| `POST /api/trades` | Opens a trade with a player, named by game account id |
| `GET /api/trades/:id` | One trade, from your side |
| `PUT /api/trades/:id/offer` | Sets what you are offering — clears both acceptances |
| `POST /api/trades/:id/accept` | Agrees, and settles when the other side already has |
| `POST /api/trades/:id/cancel` | Closes it |
| `GET /api/trades/:id/live` | WebSocket: the trade, pushed on every change |
| `POST /api/logout` | Ends the session |
| `GET /api/me` | Who you are signed in as |
| `POST /api/game-token` | A replacement client token |
| `DELETE /api/game-token` | Invalidates every client token for this account |

## What is public

The front page, the leaderboards and the connection details need no account. A
server people are being invited to play on has to be able to say what it is and
who is doing well on it before it asks them for an address and a password, and
until now `/` was a redirect to a login form.

The boards live behind the game server's internal API, which a browser cannot
reach and must not be able to — the credential that opens it answers for every
account. So they are proxied, and because that proxy is the one route anybody
on the internet can call without an account, it holds each board for fifteen
seconds. A board changes when somebody finishes a run; that much staleness is
invisible next to it.

The scope parameters (`node`, `hero`, `party`, `limit`) are passed through
rather than interpreted, except for the limit, which is clamped. Which boards
exist and what they need is the game server's business, and a second opinion
here would be one more thing to keep in step.

## Signing up

The game account is not created until the address has been proved. Minting it
at sign-up would mean an account, a hero and a working client token for every
address somebody cares to type, including addresses belonging to other people.
An unconfirmed sign-up leaves one row and nothing else.

```
POST /api/register   →  user row, confirmation link mailed, no game account
POST /api/verify     →  game account minted, linked, token returned once
```

Confirming does the four steps in this order: mint the account, link it, mark
the user confirmed, spend the link. A failure part way through leaves a game
account nobody holds a token for — a wasted row — and leaves the link working
so its owner can finish. Spending the link first would invert that, and a
hiccup on the game server would burn somebody's only way in.

Until it is confirmed, an account has no game token to ask for and
`POST /api/game-token` says so.

Without `ODW_SMTP_URL` the link is written to the log rather than sent, which
is what makes the whole flow exercisable on a laptop. Startup says so, because
in production it means nobody but the operator can sign up.

## Losing a password

Resetting is what somebody does when they think another person has been in
their account, so changing the password is the least of it. Two things go with
it, or the reset recovers nothing:

- **every web session ends**, including the intruder's;
- **every game token is revoked**. `POST /api/game-token` hands out a
  credential good for most of a year — anybody who reached the account could be
  holding one, and it would outlive the password by months.

The revocation happens first. If the game server cannot be reached the reset is
refused whole and the link stays usable, because a password that has moved on
while the old client token still plays is worse than a reset that did not
happen. A replacement client token comes back in the response, since the one in
the player's configuration file has just stopped working.

Changing a password you already know is a different situation and behaves
differently: other web sessions end, and the game client is left alone. Knowing
the current password claims no compromise, and signing somebody out of the game
for tidying up their password would be a surprise.

## Trading

The negotiation lives here and the movement does not. Who proposed the trade,
what each side is offering and who has agreed is a conversation, so it sits in
this application's own tables. The moment both sides have agreed, the game
server is asked once, and it moves the weapons and gold on a single transaction
with both accounts locked.

The rule that carries the feature is that **any change to either offer clears
both acceptances**. Without it, the moment between "they agreed" and "the goods
moved" is long enough to swap a legendary for a stick. It is enforced in the
storage layer, in the same transaction as the change, so there is no instant in
which one side's acceptance stands against an offer it never saw.

A refusal from the game server — the other player walked into a dungeon, a
weapon turned out to be equipped, a bag is full — leaves the trade open and
clears both acceptances, because whatever it objected to has to change and an
acceptance that survives a change is the thing the rule exists to prevent.

Each side sees the other's offer and not their bag. `GET /api/inventory` is
about you only.

## Tests

```bash
npm test
```

They run against the in-memory backend and a stand-in for the game server: what
is being tested is this application's half of registering — that a user row and
a game account are created together or not at all — and standing up a real
server to prove it would be testing the other repository.

## License

GPL-3.0-or-later. See the game server's `NOTICE.md` for the redistribution
boundary that project keeps; this one holds no game material at all.
