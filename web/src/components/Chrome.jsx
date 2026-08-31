import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useViewer } from "../viewer.jsx";

/**
 * A bar with the site's name at one end and, at the other, either where you
 * are or the way in.
 *
 * The links are the point. Most of this site reads without an account, so the
 * header has to offer a way to sign in rather than assume everybody already
 * has — and it must not flash "Log in" at somebody who is signed in while it
 * finds out, which is what `ready` is for.
 */
export const TopBar = ({ where }) => {
  const navigate = useNavigate();
  const { viewer, ready, refresh } = useViewer();

  const signOut = async () => {
    await api.logout();
    await refresh();
    navigate("/");
  };

  return (
    <div className="topbar">
      <Link className="topbar__name" to="/">
        Open Dungeon
      </Link>
      <span className="topbar__where">
        {where ? <span className="topbar__page">{where}</span> : null}
        <Link className="topbar__link" to="/leaderboard">
          Leaderboards
        </Link>
        {!ready ? null : viewer ? (
          <>
            <Link className="topbar__link" to="/account">
              Account
            </Link>
            <button className="topbar__link" type="button" onClick={signOut}>
              Log out
            </button>
          </>
        ) : (
          <>
            <Link className="topbar__link" to="/login">
              Log in
            </Link>
            <Link className="topbar__link" to="/register">
              Create account
            </Link>
          </>
        )}
      </span>
    </div>
  );
};

export const Box = ({ title, lede, children }) => (
  <section className="box">
    {title ? <h2 className="box__title">{title}</h2> : null}
    <div className="box__body">
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

export const Buttons = ({ children }) => <div className="buttons">{children}</div>;

export const Rows = ({ children }) => <div className="rows">{children}</div>;

export const Row = ({ label, children }) => (
  <div className="row">
    <span className="row__key">{label}</span>
    <span className="row__value">{children}</span>
  </div>
);

export const Footnote = ({ children }) => <p className="footnote">{children}</p>;

export const Quiet = ({ to, children }) => (
  <Link className="link" to={to}>
    {children}
  </Link>
);
