import { useState } from "react";
import { Button, Buttons, Notice } from "./Chrome.jsx";

/**
 * The client has no login screen — it reads an account id and a validation
 * token out of its own configuration file — so this is a pair of strings to be
 * copied into that file by hand, and the page says so plainly.
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
        Copy these into your client configuration. The token is shown once. If
        you lose it you can issue another; the account is not affected.
      </Notice>

      <span className="field__label">Account id</span>
      <code className="token">{game.accountId}</code>

      <span className="field__label">Validation token</span>
      <code className="token">{game.token}</code>

      <Buttons>
        <Button type="button" onClick={copy}>
          {copied ? "Copied" : "Copy token"}
        </Button>
      </Buttons>
    </div>
  );
};
