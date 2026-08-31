import { Link } from "react-router-dom";

/**
 * A bar with the site's name at one end and the page's at the other. There is
 * no wordmark and no crest: the name is a label, the way it is on a site whose
 * job is account admin rather than an announcement.
 */
export const TopBar = ({ where }) => (
  <div className="topbar">
    <p className="topbar__name">Open Dungeon</p>
    <span className="topbar__where">{where}</span>
  </div>
);

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
