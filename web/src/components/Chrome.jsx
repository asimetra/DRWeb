import { useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { useViewer } from "../viewer.jsx";

/* ------------------------------------------------------------------ box - */

export const Box = ({ title, lede, flush = false, children }) => (
  <section className="box">
    {title ? <h2 className="box__title">{title}</h2> : null}
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

/* -------------------------------------------------------------- sidebar - */

/**
 * The left column, which is the point of the layout.
 *
 * Signed out it is a login form, always on screen — a visitor never has to go
 * looking for the way in. Signed in it is who you are: the address, the account
 * id the client uses, and whether the address has been confirmed, which is the
 * one fact that changes what the rest of the site will let you do.
 */
const AccountBox = () => {
  const navigate = useNavigate();
  const { viewer, ready, refresh } = useViewer();
  const [form, setForm] = useState({ email: "", password: "" });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  if (!ready) return <Box title="Account" />;

  if (viewer) {
    return (
      <Box title="Account" flush>
        <Facts>
          <Fact label="Email">{viewer.email}</Fact>
          <Fact label="Account">{viewer.accountId ?? "none"}</Fact>
          <Fact label="Confirmed">{viewer.verified ? "yes" : "no"}</Fact>
        </Facts>
        <ul className="menu" style={{ borderTop: "1px solid var(--page-sunk)" }}>
          <li>
            <Link to="/account">Manage account</Link>
          </li>
          <li>
            <Link to="/trade">Trade</Link>
          </li>
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
              Log out
            </a>
          </li>
        </ul>
      </Box>
    );
  }

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
    <Box title={player.name || "Character"} flush>
      {hero ? (
        <div className="who">
          <span
            className="portrait"
            title={hero.name}
            style={
              hero.icon
                ? { backgroundImage: `url(${GAME_ICONS}${hero.icon}.png)` }
                : undefined
            }
          >
            {hero.name
              .split(" ")
              .map((word) => word[0])
              .join("")}
          </span>
          <span>
            <span className="who__hero">{hero.name}</span>
            <span className="who__level">Level {hero.level}</span>
          </span>
        </div>
      ) : null}
      <Facts>
        {player.title ? (
          <Fact label="Title">
            <span className={`title title--${player.title.tier}`}>{player.title.name}</span>
          </Fact>
        ) : null}
        <Fact label="Trophies">
          {player.trophies}
          <span className="table__quiet"> / {player.trophies_of}</span>
        </Fact>
        <Fact label="Dungeons finished">{whole.format(player.clears ?? 0)}</Fact>
        <Fact label="Heroes">{player.heroes}</Fact>
      </Facts>
    </Box>
  );
};

/**
 * The client's avatar icons, served by the game server rather than bundled
 * here — the same route and the same reasoning as the background art.
 */
const GAME_ICONS = "/content/Resources/Art2D/Icons/Avatars/";

/**
 * The margin numbers, which is what a server portal has always put there.
 *
 * A count rather than a roster — who exactly is online is a different question
 * with a different answer about privacy. A game server that is down leaves this
 * box quiet instead of taking the page with it: the boards live on this side of
 * the wall and have plenty to say without it.
 */
const ServerBox = () => {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let live = true;
    const read = () =>
      api.status().then(
        (next) => live && setStatus(next),
        () => live && setStatus({ reachable: false })
      );
    read();
    // Slow enough to be free, often enough that "online now" is not a lie.
    const timer = setInterval(read, 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  if (!status) return <Box title="Server" />;
  if (status.reachable === false) {
    return (
      <Box title="Server">
        <p className="wait">The game server is not answering.</p>
      </Box>
    );
  }

  return (
    <Box title="Server" flush>
      <Facts>
        <Fact label="Online now">{status.online ?? 0}</Fact>
        <Fact label="In a dungeon">{status.in_dungeon ?? 0}</Fact>
        <Fact label="Runs today">{whole.format(status.runs_today ?? 0)}</Fact>
        <Fact label="Up for">{sinceStarted(status.uptime_seconds ?? 0)}</Fact>
      </Facts>
    </Box>
  );
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
const MiniBoard = ({ title, metric, format }) => {
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

  if (!entries) return <Box title={title} />;
  if (!entries.length) {
    return (
      <Box title={title}>
        <p className="wait">Nobody yet.</p>
      </Box>
    );
  }

  return (
    <Box title={title} flush>
      <table className="table">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.account_id}>
              <td className="table__rank">{entry.rank}</td>
              <td>{entry.name || "unnamed"}</td>
              <td className="table__num">{format(entry.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
};

const asTime = (ms) => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const asCount = (value) => whole.format(value);

const Menu = () => (
  <Box title="Navigation" flush>
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
        <NavLink to="/account">Account</NavLink>
      </li>
    </ul>
  </Box>
);

/* ----------------------------------------------------------------- page - */

/**
 * Every page is this: a bar, a left column that does not change, and whatever
 * the page itself is. Nothing in the main column has to carry navigation.
 */
export const Page = ({ where, children }) => (
  <>
    <div className="masthead">
      <div className="masthead__inner">
        <Link className="masthead__name" to="/">
          Open Dungeon
        </Link>
        <span className="masthead__where">{where}</span>
      </div>
    </div>

    <div className="layout">
      <div className="column">
        <CharacterBox />
        <AccountBox />
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
        <MiniBoard title="Fastest Clears" metric="speedrun" format={asTime} />
        <MiniBoard title="Most Experience" metric="experience" format={asCount} />
      </div>
    </div>
  </>
);
