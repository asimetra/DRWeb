import { useState } from "react";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, TopBar } from "../components/Chrome.jsx";

export const Register = () => {
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
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <>
        <TopBar where="Create Account" />
        <Box title="Check your email">
          <p>
            A confirmation link has been sent to <strong>{form.email}</strong>.
          </p>
          <p>
            Your game account is created when you open it. Nothing has been
            created yet.
          </p>
          <Buttons>
            <Button
              type="button"
              disabled={resent}
              onClick={async () => {
                await api.resendVerification(form.email);
                setResent(true);
              }}
            >
              {resent ? "Link sent" : "Send another link"}
            </Button>
          </Buttons>
          <Footnote>
            <Quiet to="/login">Back to login</Quiet>
          </Footnote>
        </Box>
      </>
    );
  }

  return (
    <>
      <TopBar where="Create Account" />
      <Box title="Create Account">
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
            hint="At least 10 characters."
            value={form.password}
            onChange={change("password")}
          />
          <Buttons>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting" : "Create account"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          Already registered? <Quiet to="/login">Log in</Quiet>
        </Footnote>
      </Box>
    </>
  );
};
