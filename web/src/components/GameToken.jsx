import { useState } from "react";
import { Button, Notice } from "./Chrome.jsx";

/**
 * The credential, shown the only time it is ever shown.
 *
 * The client has no login screen — it reads `AccountId` and
 * `API_ValidationToken` out of its own configuration file — so this is a thing
 * to be copied by hand into a file, and the page says so rather than assuming
 * anybody knows.
 */
export const GameToken = ({ game }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(game.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <Notice kind="good">
        Copy this into your client configuration now. It is not shown again —
        losing it costs a new one, not the account.
      </Notice>

      <div className="stack">
        <div>
          <span className="field__label">Account id</span>
          <code className="token">{game.accountId}</code>
        </div>
        <div>
          <span className="field__label">Validation token</span>
          <code className="token">{game.token}</code>
        </div>
      </div>

      <div className="token__row">
        <Button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy token"}
        </Button>
      </div>
    </div>
  );
};
