import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Aside, Button, Field, Meta, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";
import { GameToken } from "../components/GameToken.jsx";

const ChangePassword = ({ onDone }) => {
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
      onDone("Password changed. Other sessions were signed out.");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "something went wrong");
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
        hint="Your game client is left alone — only web sessions end."
        value={form.newPassword}
        onChange={change("newPassword")}
      />
      <Button type="submit" disabled={busy}>
        {busy ? "Changing" : "Change password"}
      </Button>
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

  useEffect(() => {
    api.me().then(
      (result) => setUser(result.user),
      () => navigate("/login")
    );
  }, [navigate]);

  if (!user) return <Panel title="Your account"><p className="wait">Reading the ledger</p></Panel>;

  const act = async (work, message) => {
    setProblem("");
    setSaid("");
    try {
      const result = await work();
      if (message) setSaid(message);
      return result;
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "something went wrong");
      return null;
    }
  };

  return (
    <Panel title="Your account" wide>
      <Notice kind="bad">{problem}</Notice>
      <Notice kind="good">{said}</Notice>

      <Meta label="Email">{user.email}</Meta>
      <Meta label="Game account">{user.accountId ?? "not created yet"}</Meta>
      <Meta label="Address confirmed">{user.verified ? "yes" : "not yet"}</Meta>

      {game ? (
        <>
          <Rule />
          <GameToken game={game} />
        </>
      ) : null}

      <Rule />

      {user.accountId ? (
        <div className="token__row">
          <Button
            type="button"
            onClick={() =>
              act(async () => setGame(await api.newGameToken()), "A new token was issued.")
            }
          >
            New client token
          </Button>
          <Button
            kind="danger"
            type="button"
            onClick={() =>
              act(async () => {
                await api.revokeGameTokens();
                setGame(null);
              }, "Every client token for this account was revoked.")
            }
          >
            Revoke all
          </Button>
        </div>
      ) : (
        <Notice>
          Confirm your address and a game account will be created for you.
        </Notice>
      )}

      <Rule />

      {changing ? (
        <ChangePassword
          onDone={(message) => {
            setChanging(false);
            setSaid(message);
          }}
        />
      ) : (
        <Button kind="quiet" type="button" onClick={() => setChanging(true)}>
          Change password
        </Button>
      )}

      <Aside>
        <p>
          <Quiet to="/login">
            <span
              onClick={async (event) => {
                event.preventDefault();
                await api.logout();
                navigate("/login");
              }}
            >
              Sign out
            </span>
          </Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
