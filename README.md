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

The look is deliberately one thing — warm near-black stone, iron borders,
torchlight gold, square corners, Cinzel over Spectral. There is no light theme
and no theme switch: a light version would be a different design rather than
this one inverted.

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
| `GET /api/csrf` | A CSRF token, and the session that carries it |
| `POST /api/register` | Creates a user and mails a confirmation link. No game account yet |
| `POST /api/verify` | Confirms the address, creates the game account, returns the client token **once** |
| `POST /api/verify/resend` | Another link, retiring the one before it |
| `POST /api/login` | Signs in |
| `POST /api/password/forgot` | Mails a reset link |
| `POST /api/password/reset` | Sets a new password, ends every session, revokes the game token |
| `POST /api/password` | Changes a password you already know |
| `POST /api/logout` | Ends the session |
| `GET /api/me` | Who you are signed in as |
| `POST /api/game-token` | A replacement client token |
| `DELETE /api/game-token` | Invalidates every client token for this account |

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
