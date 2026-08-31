import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Footnote, Notice, Quiet, TopBar } from "../components/Chrome.jsx";
import { GameToken } from "../components/GameToken.jsx";

export const Verify = () => {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: "working" });

  /**
   * Once, whatever React does with the effect. The link is spent on use, so a
   * second call would answer "not valid" and report a failure to somebody
   * whose account had in fact just been created.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = params.get("token");
    if (!token) {
      setState({ status: "failed", problem: "This link has no token in it." });
      return;
    }

    api.verify(token).then(
      (result) => setState({ status: "done", ...result }),
      (failure) =>
        setState({
          status: "failed",
          problem: failure instanceof ApiError ? failure.message : "Something went wrong.",
        })
    );
  }, [params]);

  if (state.status === "working") {
    return (
      <>
        <TopBar where="Confirm Email" />
        <Box title="Confirm Email">
          <p className="wait">Checking the link…</p>
        </Box>
      </>
    );
  }

  if (state.status === "failed") {
    return (
      <>
        <TopBar where="Confirm Email" />
        <Box title="Confirm Email">
          <Notice kind="bad">{state.problem}</Notice>
          <p>
            Links last 24 hours and can only be used once. Log in and request
            another if yours has expired.
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
      <TopBar where="Confirm Email" />
      <Box title="Account Created">
        {state.game ? (
          <GameToken game={state.game} />
        ) : (
          <Notice>This email address was already confirmed.</Notice>
        )}
        <Footnote>
          <Quiet to="/account">Go to account management</Quiet>
        </Footnote>
      </Box>
    </>
  );
};
