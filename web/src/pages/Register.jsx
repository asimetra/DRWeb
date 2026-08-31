import { useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, Page } from "../components/Chrome.jsx";

export const Register = () => {
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [nameSays, setNameSays] = useState(null);
  const [problem, setProblem] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  /*
   * Told while they type rather than after a round trip through their email.
   * Debounced so a name is one question and not one per keystroke, and the
   * answer is thrown away if the field has moved on — an older reply landing
   * late would otherwise mark a name taken that never was.
   */
  useEffect(() => {
    const wanted = form.name.trim();
    if (wanted.length < 3) {
      setNameSays(null);
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.checkName(wanted).then(
        (verdict) => live && setNameSays(verdict),
        () => live && setNameSays(null)
      );
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.name]);

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
      <Page where="Create Account">
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
      </Page>
    );
  }

  return (
    <Page where="Create Account">
      <Box title="Create Account">
        <Notice kind="bad">{problem}</Notice>
        <form onSubmit={submit}>
          {/*
            The name comes first because it is the decision — an address is
            typed from memory, a name is chosen, and it is the only thing other
            players will ever see of them.
          */}
          <Field
            label="Character name"
            name="name"
            autoComplete="off"
            required
            minLength={3}
            maxLength={16}
            hint={
              nameSays === null
                ? "3 to 16 characters. This is what other players see."
                : nameSays.free
                  ? `${nameSays.name} is free.`
                  : nameSays.error ?? "That name is taken."
            }
            value={form.name}
            onChange={change("name")}
          />
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
            <Button type="submit" disabled={busy || nameSays?.free === false}>
              {busy ? "Submitting" : "Create account"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          Already registered? <Quiet to="/login">Log in</Quiet>
        </Footnote>
      </Box>
    </Page>
  );
};
