import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useViewer } from "../viewer.jsx";

/* ------------------------------------------------------------------ box - */

/**
 * `more` is the right-hand end of the title bar — the qualifier the heading
 * cannot carry because the display face has no digits: "level 100", "top 20".
 */
export const Box = ({ title, more, lede, flush = false, children }) => (
  <section className="box">
    {title ? (
      <h2 className="box__title">
        {title}
        {more ? <span className="more">{more}</span> : null}
      </h2>
    ) : null}
    <div className={flush ? "box__body box__body--flush" : "box__body"}>
      {lede ? <p className="lede">{lede}</p> : null}
      {children}
    </div>
  </section>
);

export const Notice = ({ kind = "", children }) =>
  children ? <p className={kind ? `notice notice--${kind}` : "notice"}>{children}</p> : null;

export const Field = ({ label, hint, ...input }) => (
  <label className="field">
    <span className="field__label">{label}</span>
    <input className="field__input" {...input} />
    {hint ? <span className="field__hint">{hint}</span> : null}
  </label>
);

export const Button = ({ kind, children, ...rest }) => (
  <button className={kind ? `button button--${kind}` : "button"} {...rest}>
    {children}
  </button>
);

export const Buttons = ({ children, ...rest }) => (
  <div className="buttons" {...rest}>
    {children}
  </div>
);

export const Footnote = ({ children }) => <p className="footnote">{children}</p>;

export const Quiet = ({ to, children }) => (
  <Link className="link" to={to}>
    {children}
  </Link>
);

/** Label and value, striped like a table so the two agree on a page. */
export const Facts = ({ children }) => (
  <table className="facts">
    <tbody>{children}</tbody>
  </table>
);

export const Fact = ({ label, children }) => (
  <tr>
    <th scope="row">{label}</th>
    <td>{children}</td>
  </tr>
);

/**
 * The rail's version of the same thing: a label, a number, and a dotted rule
 * between. A ruled table in a 13.5rem column is a grid of borders drawn to say
 * four things — the table earns its rules where there is a table's worth of
 * data to read down, and a margin does not have one.
 */
export const Stat = ({ label, children }) => (
  <div className="stat">
    <span className="stat__k">{label}</span>
    <span className="stat__v">{children}</span>
  </div>
);

/* -------------------------------------------------------------- sidebar - */

/**
 * The way in, and only when there is no way in yet.
 *
 * Signed out it is a login form, always on screen — a visitor never has to go
 * looking for it. Signed in there is no account box at all: the character panel
 * above is who you are, and managing the account is a line in the menu below,
 * where the rest of the site's destinations already live. Two panels both
 * answering "who are you" is what was overflowing the rail, and the address was
 * the string doing the overflowing.
 */
const LogInBox = () => {
  const navigate = useNavigate();
  const { viewer, ready, refresh } = useViewer();
  const [form, setForm] = useState({ email: "", password: "" });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) return <Box title="Log In" />;
  if (viewer) return null;

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      await api.login(form);
      await refresh();
      navigate("/account");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Box title="Log In">
      <Notice kind="bad">{problem}</Notice>
      <form onSubmit={submit}>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={(event) => setForm({ ...form, email: event.target.value })}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
        />
        <Buttons>
          <Button type="submit" disabled={busy}>
            {busy ? "…" : "Log in"}
          </Button>
        </Buttons>
      </form>
      <Footnote>
        <Quiet to="/register">Create account</Quiet>
        {" · "}
        <Quiet to="/forgot">Lost password</Quiet>
      </Footnote>
    </Box>
  );
};

/* --------------------------------------------------------------- widgets - */

/**
 * The character, which is what a player opens a server's site to look at.
 *
 * Everything shown here is the game server's own answer: the title comes from
 * the trophy ladder, the level from the Leveling table and differs per hero,
 * the clears from the boards. The portrait is the client's own avatar icon,
 * served by the game server, and the frame is drawn either way so a missing
 * picture leaves a gap rather than a hole.
 */
const CharacterBox = () => {
  const { viewer, ready } = useViewer();
  const [player, setPlayer] = useState(null);

  useEffect(() => {
    if (!ready || !viewer?.accountId) return undefined;
    let live = true;
    api.character().then(
      (next) => live && setPlayer(next),
      () => live && setPlayer({ reachable: false })
    );
    return () => {
      live = false;
    };
  }, [ready, viewer?.accountId]);

  if (!ready || !viewer?.accountId) return null;
  if (!player) return <Box title="Character" />;
  if (player.reachable === false) {
    return (
      <Box title="Character">
        <p className="wait">The game server is not answering.</p>
      </Box>
    );
  }

  const hero = player.hero;
  return (
    <Box title={player.name || "Character"} more={hero ? `level ${hero.level}` : null}>
      {hero ? (
        <div className="who who--me">
          <Portrait hero={hero} mine />
          <span>
            <span className="who__hero">{hero.name}</span>
            <span className="who__level">Level {hero.level}</span>
          </span>
        </div>
      ) : null}
      {player.title ? (
        <Stat label="Title">
          <span className={`title title--${player.title.tier}`}>{player.title.name}</span>
        </Stat>
      ) : null}
      <Stat label="Trophies">
        {player.trophies ?? 0}
        <span className="table__quiet"> / {player.trophies_of ?? 12}</span>
      </Stat>
      <Stat label="Dungeons finished">{whole.format(player.clears ?? 0)}</Stat>
      {player.heroes ? <Stat label="Heroes">{whole.format(player.heroes)}</Stat> : null}
    </Box>
  );
};

/**
 * The client's avatar icons, served by the game server rather than bundled
 * here — the same route and the same reasoning as the background art.
 */
export const GAME_ICONS = "/content/Resources/Art2D/Icons/Avatars/";

/**
 * A hero's picture, with its initials behind it.
 *
 * The frame is drawn either way, so an icon the game server is not serving
 * leaves a gap in the row rather than a hole in the layout.
 */
export const Portrait = ({ hero, mine = false }) => (
  <span
    className={mine ? "portrait portrait--me" : "portrait"}
    title={hero?.name}
    style={hero?.icon ? { backgroundImage: `url(${GAME_ICONS}${hero.icon}.png)` } : undefined}
  >
    {hero ? hero.name.split(" ").map((word) => word[0]).join("") : ""}
  </span>
);

/*
 * One poll for the whole page.
 *
 * The crest line and the server panel are the same four numbers, and two
 * components each running their own minute timer would ask for them twice.
 */
let statusNow = null;
let statusTimer = null;
const watchers = new Set();

const readStatus = () =>
  api
    .status()
    .then(
      (next) => (statusNow = next),
      () => (statusNow = { reachable: false })
    )
    .then(() => watchers.forEach((tell) => tell(statusNow)));

const useStatus = () => {
  const [status, setStatus] = useState(statusNow);

  useEffect(() => {
    watchers.add(setStatus);
    if (!statusTimer) {
      readStatus();
      // Slow enough to be free, often enough that "online now" is not a lie.
      statusTimer = setInterval(readStatus, 60_000);
    }
    return () => {
      watchers.delete(setStatus);
      if (!watchers.size) {
        clearInterval(statusTimer);
        statusTimer = null;
      }
    };
  }, []);

  return status;
};

/**
 * The margin numbers, which is what a server portal has always put there.
 *
 * A count rather than a roster — who exactly is online is a different question
 * with a different answer about privacy. A game server that is down leaves this
 * box quiet instead of taking the page with it: the boards live on this side of
 * the wall and have plenty to say without it.
 */
const ServerBox = () => {
  const status = useStatus();

  if (!status) return <Box title="Server" />;
  if (status.reachable === false) {
    return (
      <Box title="Server">
        <p className="wait">The game server is not answering.</p>
      </Box>
    );
  }

  return (
    <Box title="Server">
      <Stat label="Online now">{whole.format(status.online ?? 0)}</Stat>
      <Stat label="In a dungeon">{whole.format(status.in_dungeon ?? 0)}</Stat>
      <Stat label="Runs today">{whole.format(status.runs_today ?? 0)}</Stat>
      <Stat label="Up for">{sinceStarted(status.uptime_seconds ?? 0)}</Stat>
    </Box>
  );
};

/** The one line under the page's name: who is afield, and what today has been. */
const crestLine = (status) => {
  if (!status) return " ";
  if (status.reachable === false) return "The game server is not answering.";
  const afield = status.online ?? 0;
  const runs = status.runs_today ?? 0;
  const who =
    afield === 0 ? "nobody afield" : afield === 1 ? "one adventurer afield" : `${whole.format(afield)} adventurers afield`;
  const done = runs === 0 ? "no runs yet today" : runs === 1 ? "one run today" : `${whole.format(runs)} runs today`;
  return `${who} · ${done}`;
};

const whole = new Intl.NumberFormat("en-GB");

/** Days and hours: nobody reading a front page wants the seconds. */
const sinceStarted = (seconds) => {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  if (days) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

/**
 * A board in five lines, for a margin.
 *
 * The rank wears the rarity ladder the same way the full table does, so a
 * colour means the same thing wherever it turns up on the site.
 */
const MiniBoard = ({ title, more, metric, format }) => {
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    let live = true;
    api.leaderboard(metric, { limit: 5 }).then(
      (board) => live && setEntries(board.entries ?? []),
      () => live && setEntries([])
    );
    return () => {
      live = false;
    };
  }, [metric]);

  if (!entries) return <Box title={title} more={more} />;
  if (!entries.length) {
    return (
      <Box title={title} more={more}>
        <p className="wait">Nobody yet.</p>
      </Box>
    );
  }

  return (
    <Box title={title} more={more}>
      <ul className="mini">
        {entries.map((entry) => (
          <li key={entry.account_id}>
            <span className="mini__pos">{entry.rank}</span>
            <span className="mini__nm">{entry.name || "unnamed"}</span>
            <span className="mini__vl">{format(entry.value)}</span>
          </li>
        ))}
      </ul>
    </Box>
  );
};

const asCount = (value) => whole.format(value);

/**
 * Where the site goes, and — when there is somebody to sign out — the account
 * lines too. Managing an account is a destination like any other, and giving it
 * a panel of its own in the margin was a second answer to a question the
 * character panel had already answered.
 */
const Menu = () => {
  const navigate = useNavigate();
  const { viewer, ready, refresh } = useViewer();

  return (
    <Box title="Menu" flush>
      <ul className="menu">
        <li>
          <NavLink to="/" end>
            News
          </NavLink>
        </li>
        <li>
          <NavLink to="/leaderboard">Hall of Deeds</NavLink>
        </li>
        <li>
          <NavLink to="/trade">Trade</NavLink>
        </li>
        <li>
          <NavLink to="/account">My account</NavLink>
        </li>
        {ready && viewer ? (
          <li>
            <a
              href="/"
              onClick={async (event) => {
                event.preventDefault();
                await api.logout();
                await refresh();
                navigate("/");
              }}
            >
              Sign out
            </a>
          </li>
        ) : null}
      </ul>
    </Box>
  );
};

/**
 * Signed up but not playing yet, which is the one thing neither the character
 * panel nor the menu can say — there is no character to draw.
 */
const NotPlayingYet = () => {
  const { viewer, ready } = useViewer();
  if (!ready || !viewer || viewer.accountId) return null;
  return (
    <Box title="Character">
      <p className="wait">
        {viewer.verified ? "No game account yet." : "Confirm your address to play."}
      </p>
    </Box>
  );
};

/* ----------------------------------------------------------------- page - */

/**
 * Every page is this: a crest, a left column that does not change, and whatever
 * the page itself is. Nothing in the main column has to carry navigation.
 */
export const Page = ({ where, children }) => {
  const status = useStatus();

  return (
    <>
      <div className="crest">
        <h1 className="crest__name">{where}</h1>
        <p className="crest__line">{crestLine(status)}</p>
      </div>

      <div className="layout">
        <div className="column">
          <LogInBox />
          <CharacterBox />
          <NotPlayingYet />
          <Menu />
          <ServerBox />
        </div>
        <div className="column">{children}</div>
        {/*
          The right rail is the standings, always on screen. It is the reason
          somebody opens a server's site on a weekday, so it does not wait behind
          a link — and it is the first thing to fold away when the window is too
          narrow to carry three columns.
        */}
        <div className="column column--aside">
          <MiniBoard
            title="Most Experience"
            more="lifetime"
            metric="experience"
            format={asCount}
          />
          <MiniBoard
            title="Dungeons Finished"
            more="lifetime"
            metric="clears"
            format={asCount}
          />
        </div>
      </div>

      {/*
        Where the art and the face came from. They are the game's own, served by
        the game server at /content/… and never bundled into this repository —
        which is a thing worth saying on the page rather than only in a comment.
      */}
      <footer className="site-foot">
        Rank colours are the game's rarity ladder. Background art, headline face
        and portraits are the game's own, served at <code>/content/…</code>.
      </footer>
    </>
  );
};
