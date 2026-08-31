import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Aside, Button, Field, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";
import { GameToken } from "../components/GameToken.jsx";

export const Reset = () => {
  const [params] = useSearchParams();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      setDone(await api.resetPassword({ token: params.get("token"), password }));
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Panel title="Taken back" lede="The password is changed and every session has been closed." wide>
        <Notice kind="good">
          Your old client token was revoked as well — anybody who had taken one
          cannot keep playing on it.
        </Notice>
        {done.game ? <GameToken game={done.game} /> : null}
        <Rule />
        <Aside>
          <p>
            <Quiet to="/account">Go to your account</Quiet>
          </p>
        </Aside>
      </Panel>
    );
  }

  return (
    <Panel title="Choose a new password" lede="Everything signed in with the old one will be shut out.">
      <Notice kind="bad">{problem}</Notice>
      <form onSubmit={submit}>
        <Field
          label="New password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least ten characters."
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Rule />
        <Button type="submit" disabled={busy}>
          {busy ? "Setting" : "Set the password"}
        </Button>
      </form>
      <Aside>
        <p>
          <Quiet to="/forgot">Ask for another link</Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
