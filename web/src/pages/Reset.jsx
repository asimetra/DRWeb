import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, Page } from "../components/Chrome.jsx";
import { useViewer } from "../viewer.jsx";
import { GameToken } from "../components/GameToken.jsx";

export const Reset = () => {
  const [params] = useSearchParams();
  const linkToken = useRef(
    params.get("token") || new URLSearchParams(window.location.hash.slice(1)).get("token")
  ).current;
  const { refresh } = useViewer();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  useEffect(() => {
    const clean = new URL(window.location.href);
    clean.searchParams.delete("token");
    clean.hash = "";
    window.history.replaceState({}, "", `${clean.pathname}${clean.search}`);
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      setDone(await api.resetPassword({ token: linkToken, password }));
      await refresh();
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Page where="Reset Password">
        <Box title="Password Changed">
          <Notice kind="good">
            All sessions were closed and every game token for this account was
            revoked, so nobody can keep playing on a token taken while they had
            access.
          </Notice>
          {done.game ? <GameToken game={done.game} /> : null}
          <Footnote>
            <Quiet to="/account">Go to account management</Quiet>
          </Footnote>
        </Box>
      </Page>
    );
  }

  return (
    <Page where="Reset Password">
      <Box title="Choose a New Password" lede="Anything signed in with the old password will be logged out.">
        <Notice kind="bad">{problem}</Notice>
        <form onSubmit={submit}>
          <Field
            label="New password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={10}
            hint="At least 10 characters."
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Buttons>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting" : "Set password"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          <Quiet to="/forgot">Request another link</Quiet>
        </Footnote>
      </Box>
    </Page>
  );
};
