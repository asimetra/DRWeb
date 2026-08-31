import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Aside, Button, Field, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";

export const Register = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      await api.register(form);
      setSent(true);
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Panel title="Check your mail" lede={`A link is on its way to ${form.email}.`}>
        <Notice>
          Your account is made when you open it — not before. Nothing has been
          created yet, and nothing will be if the link is never opened.
        </Notice>
        <Rule />
        <Button
          type="button"
          kind="quiet"
          disabled={resent}
          onClick={async () => {
            await api.resendVerification(form.email);
            setResent(true);
          }}
        >
          {resent ? "Another link sent" : "Send it again"}
        </Button>
        <Aside>
          <p>
            <Quiet to="/login">Back to the door</Quiet>
          </p>
        </Aside>
      </Panel>
    );
  }

  return (
    <Panel title="Take up arms" lede="An address and a password. The rest is decided in the dungeon.">
      <Notice kind="bad">{problem}</Notice>
      <form onSubmit={submit}>
        <Field
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={form.email}
          onChange={change("email")}
        />
        <Field
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={10}
          hint="At least ten characters."
          value={form.password}
          onChange={change("password")}
        />
        <Rule />
        <Button type="submit" disabled={busy}>
          {busy ? "Sending" : "Sign up"}
        </Button>
      </form>
      <Aside>
        <p>
          Already have a name here? <Quiet to="/login">Sign in</Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
