import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Aside, Button, Field, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";

export const Login = () => {
  const navigate = useNavigate();
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
      navigate("/account");
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "something went wrong");
      setBusy(false);
    }
  };

  return (
    <Panel title="Enter" lede="The way back in.">
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
        <Rule />
        <Button type="submit" disabled={busy}>
          {busy ? "Opening" : "Sign in"}
        </Button>
      </form>
      <Aside>
        <p>
          <Quiet to="/forgot">Lost the password</Quiet>
        </p>
        <p>
          No account yet? <Quiet to="/register">Sign up</Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
