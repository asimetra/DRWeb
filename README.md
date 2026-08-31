# Open Dungeon Web

The web front end for an [Open Dungeon Server](https://github.com/asimetra/DRServer)
deployment: signing up, signing in, and handing a player the credential their
game client actually uses.

Server code only. It is useless on its own — it needs a game server to talk to.

## The division

The game server owns the account tables and is the only thing that writes them.
That is not tidiness. It keeps the accounts that are in play as live objects in
memory and orders its writers with locks that are local to that process, so a
second process writing the same rows sits outside both: a sale settled here
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

Two columns. The left one holds who you are signed in as — or a login form when
nobody is — and the navigation, so it is always reachable and the main column is
never spent on it. The right one is only ever the page itself.

Every box is a band of frame with a lighter panel set into it and the title
sitting on the band; that one repeated device is what makes a page of unlike
things read as one site. Tables are the panel rather than something laid inside
it: flush to the frame, header bar in the frame's own colour, rows striped. Fact
lists use the same stripes so the two agree.

No display face, no webfont, no ornament. The copy matches: buttons say what
they do and nothing narrates.

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
| `GET /api/market` | Everything up for sale — open, no sign-in needed |
| `GET /api/market/stall` | Your own: what is up, what sold, what is owed |
| `POST /api/market` | Puts a weapon up at a price |
| `POST /api/market/:id/buy` | Buys one |
| `POST /api/market/:id/cancel` | Takes one of yours back down |
| `POST /api/market/claim` | Collects the gold from everything that sold |
| `POST /api/logout` | Ends the session |
| `GET /api/me` | Who you are signed in as |
| `POST /api/game-token` | A replacement client token |
| `DELETE /api/game-token` | Invalidates every client token for this account |

## What is public

The front page and the leaderboards need no account. A
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

## The market

A player puts a weapon up at a price and walks away; anybody buys it; the seller
collects the gold when they next look. Nobody has to be online at the same time
as anybody else, which is the whole difference from the trade window this
replaced and the reason it is worth having on a server whose players are not all
awake at once.

**None of it lives here.** A listed weapon has left a bag and a sale moves gold
between two accounts, so every part of it is game state and belongs to the
server that owns the accounts. That server keeps the listing on the seller's own
account — beside their weapons rather than in a table of its own — so putting
one up is a single atomic write rather than two writes with a crash-shaped gap
between them.

This application's whole job is to say **who is asking**, and that is the
security of the feature. The game server's internal API is behind a shared token
and will act on whatever account id it is handed, so every route here takes the
id from the session and ignores the request's opinion of it. A `sellerId` a
browser could choose would be a way to sell somebody else's weapons.

Refusals are passed through with their own status rather than flattened, because
the screen has to do different things with them: `410` means somebody bought it
first and the row should come off the page, `409` means something the player can
fix — a full bag, a weapon still equipped, being in a dungeon.

`GET /api/market` is readable signed out. A market nobody can look at before
joining is a market nobody joins for.

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

## The game's own art

The site reads two files from `web/public/`, and neither is in this repository:

| file | what it is |
| --- | --- |
| `ground.jpg` | a dungeon's loading art, desaturated and darkened |
| `display.woff2` | the client's headline face, subset to letters |

They are the game's assets rather than this project's. The server repository
refuses to carry anything of the kind — `.swf`, its resource tree, even the
product name — and this repository keeps the same line by ignoring the
directory. Without them the site renders on the plain dark ground with a serif
fallback: duller, not broken.

To produce them from a client you already own, with Pillow and fonttools:

```py
from PIL import Image, ImageEnhance
im = Image.open("<a loading screen>.jpg").convert("L")
im = ImageEnhance.Contrast(im).enhance(1.15)
im = ImageEnhance.Brightness(im).enhance(0.42)   # dark enough to read type on
im.resize((1920, 1072)).save("web/public/ground.jpg", quality=74, optimize=True)
```

```py
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
f = TTFont("<the client's display face>.ttf")
s = Subsetter(options=Options()); s.populate(text=
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"); s.subset(f)
f.flavor = "woff2"; f.save("web/public/display.woff2")
```

The face carries **letters only** — no digits, no punctuation — which is why
the stylesheet puts it on headings and labels and never on data: a heading with
a number in it would break mid-word into the fallback.

A public deployment should satisfy itself about both licences first. The font's
`fsType` is 0, its own "embedding unrestricted" flag, but that is a technical
signal and not a licence.

## Running it

Configuration is read from `.env` when there is one — `npm start` passes
`--env-file-if-exists`, so a checkout without the file still starts and the
tests need nothing at all. Copy `.env.example` and fill in the two values that
have no default.

```
cp .env.example .env
```

`ODW_SESSION_SECRET` is this site's own, and any 32 characters will do.
`ODW_GAME_INTERNAL_TOKEN` must be **identical** to the game server's
`ODS_INTERNAL_TOKEN`, because it is the one secret the two processes share. It
is not the game's token secret, which signs player tokens and never leaves that
process.

Then, in one terminal each:

```
cd ../Dungeon-Rampage-Server && ODS_INTERNAL_TOKEN=<the same value> npm start
npm run serve
```

`npm run serve` builds the front end and starts the server, which serves both
the site and the API from one process. Two processes are only for working on
the front end, where `npm run dev:web` gives hot reload and proxies `/api`
through to `npm start` on port 3000.

To check the pair is talking:

```
curl -H "X-Internal-Token: <the shared value>" http://127.0.0.1:8081/internal/v1/status
```

A 200 and some counts means the chain is up. A 401 means the two values differ.
Connection refused means the game server was started without the variable and
its internal API is switched off.

### Signing up without a mail server

With no SMTP configured the confirmation link is written to the log rather than
posted, so registering works on a laptop: sign up, copy the link out of the
game server's terminal, open it. Verification is not skipped and there is no
switch to skip it — a shortcut there would be one to unpick later, and the flow
already works without one.
