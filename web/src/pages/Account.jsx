import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, Fact, Facts, Page } from "../components/Chrome.jsx";
import { GameToken } from "../components/GameToken.jsx";

const ChangePassword = ({ onDone, onCancel }) => {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      await api.changePassword(form);
      onDone("Password changed. Other sessions were logged out.");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <Notice kind="bad">{problem}</Notice>
      <Field
        label="Current password"
        type="password"
        autoComplete="current-password"
        required
        value={form.currentPassword}
        onChange={change("currentPassword")}
      />
      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="Your game client is not affected. Only web sessions are logged out."
        value={form.newPassword}
        onChange={change("newPassword")}
      />
      <Buttons>
        <Button type="submit" disabled={busy}>
          {busy ? "Submitting" : "Change password"}
        </Button>
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
      </Buttons>
    </form>
  );
};

export const Account = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [game, setGame] = useState(null);
  const [said, setSaid] = useState("");
  const [problem, setProblem] = useState("");
  const [changing, setChanging] = useState(false);
  const [server, setServer] = useState(null);

  useEffect(() => {
    api.server().then(setServer, () => undefined);
    api.me().then(
      (result) => setUser(result.user),
      () => navigate("/login")
    );
  }, [navigate]);

  if (!user) {
    return (
      <Page where="Account Management">
        <Box title="Account Management">
          <p className="wait">Loading…</p>
        </Box>
      </Page>
    );
  }

  const act = async (work, message) => {
    setProblem("");
    setSaid("");
    try {
      await work();
      if (message) setSaid(message);
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
    }
  };

  return (
    <Page where="Account Management">

      <Box title="Account Information">
        <Notice kind="bad">{problem}</Notice>
        <Notice kind="good">{said}</Notice>
        <Facts>
          <Fact label="Email">{user.email}</Fact>
          <Fact label="Game account">{user.accountId ?? "none"}</Fact>
          <Fact label="Email confirmed">{user.verified ? "yes" : "no"}</Fact>
        </Facts>
        <Footnote>
          <Quiet to="/trade">Trade with another player</Quiet>
        </Footnote>
      </Box>

      <Box
        title="Game Client"
        lede="What your client reads from its own configuration file."
      >
        {server ? (
          <>
            <span className="field__label">Server address</span>
            <code className="token">{server.gameAddress}</code>
          </>
        ) : null}
        {user.accountId ? (
          <>
            {game ? <GameToken game={game} /> : null}
            <Buttons>
              <Button
                type="button"
                onClick={() =>
                  act(async () => setGame(await api.newGameToken()), "A new token was issued.")
                }
              >
                Issue new token
              </Button>
              <Button
                kind="danger"
                type="button"
                onClick={() =>
                  act(async () => {
                    await api.revokeGameTokens();
                    setGame(null);
                  }, "All tokens for this account were revoked.")
                }
              >
                Revoke all tokens
              </Button>
            </Buttons>
          </>
        ) : (
          <Notice>
            Confirm your email address and a game account will be created.
          </Notice>
        )}
      </Box>

      <Box title="Password">
        {changing ? (
          <ChangePassword
            onCancel={() => setChanging(false)}
            onDone={(message) => {
              setChanging(false);
              setSaid(message);
            }}
          />
        ) : (
          <Buttons>
            <Button type="button" onClick={() => setChanging(true)}>
              Change password
            </Button>
          </Buttons>
        )}
      </Box>
    </Page>
  );
};
