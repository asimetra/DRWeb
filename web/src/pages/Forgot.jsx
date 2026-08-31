import { useState } from "react";
import { api } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Quiet, TopBar } from "../components/Chrome.jsx";

export const Forgot = () => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    // The answer is the same either way, which is why the failure is ignored.
    await api.forgotPassword(email).catch(() => undefined);
    setSent(true);
    setBusy(false);
  };

  if (sent) {
    return (
      <>
        <TopBar where="Reset Password" />
        <Box title="Reset Password">
          <p>If an account exists for that address, a reset link is on its way to it.</p>
          <p>
            The answer is the same whether or not the address is registered, so
            that this page cannot be used to find out who has an account here.
          </p>
          <Footnote>
            <Quiet to="/login">Back to login</Quiet>
          </Footnote>
        </Box>
      </>
    );
  }

  return (
    <>
      <TopBar where="Reset Password" />
      <Box title="Reset Password" lede="Enter the email address you registered with.">
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
          <Buttons>
            <Button type="submit" disabled={busy}>
              {busy ? "Submitting" : "Send reset link"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          <Quiet to="/login">Back to login</Quiet>
        </Footnote>
      </Box>
    </>
  );
};
