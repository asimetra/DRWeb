import { useState } from "react";
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

const Menu = () => (
  <Box title="Navigation" flush>
    <ul className="menu">
      <li>
        <NavLink to="/" end>
          Front page
        </NavLink>
      </li>
      <li>
        <NavLink to="/leaderboard">Leaderboards</NavLink>
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
        <AccountBox />
        <Menu />
      </div>
      <div className="column">{children}</div>
    </div>
  </>
);
