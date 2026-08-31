import { useState } from "react";
import { api } from "../api.js";
import { Aside, Button, Field, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";

export const Forgot = () => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    // The answer is the same either way — see the note below, which is the
    // same reason the server gives.
    await api.forgotPassword(email).catch(() => undefined);
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <Panel title="If that address is known here" lede="A link is on its way to it.">
        <Notice>
          We answer the same whether or not anybody has signed up with that
          address, so that this page cannot be used to find out who has.
        </Notice>
        <Aside>
          <p>
            <Quiet to="/login">Back to the door</Quiet>
          </p>
        </Aside>
      </Panel>
    );
  }

  return (
    <Panel title="Lost the password" lede="Give the address you signed up with.">
      <form onSubmit={submit}>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Rule />
        <Button type="submit" disabled={busy}>
          {busy ? "Sending" : "Send a link"}
        </Button>
      </form>
      <Aside>
        <p>
          <Quiet to="/login">Back to the door</Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
