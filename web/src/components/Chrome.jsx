import { Link } from "react-router-dom";

/**
 * The sigil over the door: a keyhole cut into a shield, drawn rather than
 * lettered so the page has one mark that is not type.
 */
const Sigil = () => (
  <svg className="crest__mark" width="46" height="52" viewBox="0 0 46 52" fill="none" aria-hidden="true">
    <path
      d="M23 2 4 9v18c0 12 8 19 19 23 11-4 19-11 19-23V9L23 2Z"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    <path d="M23 8 9 13v14c0 9 6 15 14 18 8-3 14-9 14-18V13L23 8Z" stroke="currentColor" strokeWidth="0.7" opacity=".55" />
    <circle cx="23" cy="24" r="4.4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M23 28.4 20.8 38h4.4L23 28.4Z" fill="currentColor" />
  </svg>
);

export const Crest = ({ sub = "Dungeon Server" }) => (
  <header className="crest">
    <Sigil />
    <h1 className="crest__title">Open Dungeon</h1>
    <p className="crest__sub">{sub}</p>
  </header>
);

export const Panel = ({ title, lede, wide = false, children }) => (
  <section className={wide ? "panel panel--wide" : "panel"}>
    {title ? <h2 className="panel__head">{title}</h2> : null}
    {lede ? <p className="panel__lede">{lede}</p> : null}
    {children}
  </section>
);

export const Rule = () => (
  <div className="rule" aria-hidden="true">
    <span className="rule__gem" />
  </div>
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

export const Meta = ({ label, children }) => (
  <div className="meta">
    <span className="meta__key">{label}</span>
    <span className="meta__value">{children}</span>
  </div>
);

export const Aside = ({ children }) => <div className="aside">{children}</div>;

export const Quiet = ({ to, children }) => (
  <Link className="link" to={to}>
    {children}
  </Link>
);
