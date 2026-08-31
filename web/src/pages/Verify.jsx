import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Aside, Notice, Panel, Quiet, Rule } from "../components/Chrome.jsx";
import { GameToken } from "../components/GameToken.jsx";

export const Verify = () => {
  const [params] = useSearchParams();
  const [state, setState] = useState({ status: "working" });

  /**
   * Once, whatever React does with the effect. The token is spent on use, so a
   * second call would answer "not valid" and show a failure to somebody whose
   * account was in fact just created.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = params.get("token");
    if (!token) {
      setState({ status: "failed", problem: "that link is missing its token" });
      return;
    }

    api.verify(token).then(
      (result) => setState({ status: "done", ...result }),
      (failure) =>
        setState({
          status: "failed",
          problem: failure instanceof ApiError ? failure.message : "something went wrong",
        })
    );
  }, [params]);

  if (state.status === "working") {
    return (
      <Panel title="Confirming">
        <p className="wait">Opening the gate</p>
      </Panel>
    );
  }

  if (state.status === "failed") {
    return (
      <Panel title="That link did not work" lede={state.problem}>
        <Notice>
          Links last a day and are spent when they are used. If yours has run
          out, sign in and ask for another.
        </Notice>
        <Aside>
          <p>
            <Quiet to="/login">Sign in</Quiet>
          </p>
        </Aside>
      </Panel>
    );
  }

  return (
    <Panel title="The gate is open" lede="Your account exists. Here is what the client needs." wide>
      {state.game ? (
        <GameToken game={state.game} />
      ) : (
        <Notice>This address was already confirmed. Nothing more to do.</Notice>
      )}
      <Rule />
      <Aside>
        <p>
          <Quiet to="/account">Go to your account</Quiet>
        </p>
      </Aside>
    </Panel>
  );
};
