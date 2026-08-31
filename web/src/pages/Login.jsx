import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, Page } from "../components/Chrome.jsx";
import { useViewer } from "../viewer.jsx";

export const Login = () => {
  const navigate = useNavigate();
  const { refresh } = useViewer();
  const [form, setForm] = useState({ email: "", password: "" });
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      await api.login(form);
      await refresh();
      navigate("/account");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <Page where="Login">
      <Box title="Account Login">
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
            autoComplete="current-password"
            required
            value={form.password}
            onChange={change("password")}
          />
          <Buttons>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting" : "Log in"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          <Quiet to="/forgot">Forgot your password?</Quiet>
          {" · "}
          <Quiet to="/register">Create an account</Quiet>
        </Footnote>
      </Box>
    </Page>
  );
};
