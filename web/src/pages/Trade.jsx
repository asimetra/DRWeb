import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Field, Footnote, Notice, Quiet, TopBar } from "../components/Chrome.jsx";

const Ware = ({ item, children }) => (
  <li className="ware">
    {children}
    <span className="ware__id">#{item.id}</span>
    <span className="ware__fact">
      power {item.power} · rarity {item.rarity} · level {item.level}
    </span>
  </li>
);

const Side = ({ title, side }) => (
  <div className="side">
    <p className="side__who">
      <span>
        {title} ({side.accountId})
      </span>
      <span className={side.accepted ? "side__state side__state--yes" : "side__state"}>
        {side.accepted ? "accepted" : "not accepted"}
      </span>
    </p>
    {side.items.length ? (
      <ul className="wares">
        {side.items.map((item) => (
          <Ware key={item.id} item={item} />
        ))}
      </ul>
    ) : (
      <p className="ware ware--none">no weapons</p>
    )}
    <p className="side__gold">{side.gold} gold</p>
  </div>
);

/**
 * Starting one. Somebody is named by the account id their client uses — the
 * number they can read off their own screen — rather than the address they
 * signed up with, which is not theirs to hand around.
 */
const StartTrade = () => {
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setProblem("");
    setBusy(true);
    try {
      const trade = await api.startTrade(Number(accountId));
      navigate(`/trade/${trade.id}`);
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar where="Trade" />
      <Box title="Start a Trade" lede="Enter the account id of the player you want to trade with.">
        <Notice kind="bad">{problem}</Notice>
        <form onSubmit={submit}>
          <Field
            label="Account id"
            inputMode="numeric"
            required
            value={accountId}
            onChange={(event) => setAccountId(event.target.value.replace(/\D/g, ""))}
          />
          <Buttons>
            <Button type="submit" disabled={busy}>
              {busy ? "Opening" : "Open trade"}
            </Button>
          </Buttons>
        </form>
        <Footnote>
          <Quiet to="/account">Back to account management</Quiet>
        </Footnote>
      </Box>
    </>
  );
};

const OpenTrade = ({ id }) => {
  const [trade, setTrade] = useState(null);
  const [bag, setBag] = useState(null);
  const [chosen, setChosen] = useState(() => new Set());
  const [gold, setGold] = useState("0");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  /**
   * The socket carries every change either side makes, so the screen follows
   * the other person rather than the person looking at it.
   */
  useEffect(() => {
    api.trade(id).then(setTrade, (failure) => setProblem(failure.message));
    api.inventory().then(setBag, () => undefined);

    const url = `${location.origin.replace(/^http/, "ws")}/api/trades/${id}/live`;
    const socket = new WebSocket(url);
    socket.onmessage = (event) => setTrade(JSON.parse(event.data));
    return () => socket.close();
  }, [id]);

  const act = useCallback(async (work) => {
    setProblem("");
    setBusy(true);
    try {
      setTrade(await work());
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  if (!trade) {
    return (
      <>
        <TopBar where="Trade" />
        <Box title="Trade">
          <Notice kind="bad">{problem}</Notice>
          {problem ? null : <p className="wait">Loading…</p>}
        </Box>
      </>
    );
  }

  const closed = trade.state !== "open";
  const toggle = (itemId) => {
    const next = new Set(chosen);
    if (next.has(itemId)) next.delete(itemId);
    else next.add(itemId);
    setChosen(next);
  };

  return (
    <>
      <TopBar where="Trade" />

      <Box title={`Trade #${trade.id}`}>
        <Notice kind="bad">{problem}</Notice>
        {trade.state === "settled" ? (
          <Notice kind="good">
            Done. The weapons and gold have moved. Your client will show them
            the next time it reads your account.
          </Notice>
        ) : null}
        {trade.state === "cancelled" ? <Notice>This trade was cancelled.</Notice> : null}

        <div className="sides">
          <Side title="Them" side={trade.them} />
          <Side title="You" side={trade.you} />
        </div>

        {closed ? null : (
          <Buttons>
            <Button
              type="button"
              disabled={busy || trade.you.accepted}
              onClick={() => act(() => api.acceptTrade(id))}
            >
              {trade.you.accepted ? "Accepted" : "Accept"}
            </Button>
            <Button
              kind="danger"
              type="button"
              disabled={busy}
              onClick={() => act(() => api.cancelTrade(id))}
            >
              Cancel trade
            </Button>
          </Buttons>
        )}

        <Footnote>
          Changing either offer clears both acceptances. Nothing moves until you
          have both accepted the offers as they stand.
        </Footnote>
      </Box>

      {closed ? null : (
        <Box title="Your Bag" lede="Equipped weapons cannot be traded. Unequip them in the game first.">
          {bag ? (
            <>
              <ul className="wares">
                {bag.items.length ? (
                  bag.items.map((item) => (
                    <Ware key={item.id} item={item}>
                      <input
                        type="checkbox"
                        checked={chosen.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    </Ware>
                  ))
                ) : (
                  <li className="ware ware--none">nothing unequipped to offer</li>
                )}
              </ul>

              <p className="gold-field">
                <span>Gold</span>
                <input
                  className="field__input"
                  inputMode="numeric"
                  value={gold}
                  onChange={(event) => setGold(event.target.value.replace(/\D/g, "") || "0")}
                />
                <span>of {bag.gold}</span>
              </p>

              <Buttons>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(() => api.setTradeOffer(id, { items: [...chosen], gold: Number(gold) }))
                  }
                >
                  Put on the table
                </Button>
              </Buttons>
            </>
          ) : (
            <p className="wait">Loading…</p>
          )}
        </Box>
      )}
    </>
  );
};

export const Trade = () => {
  const { id } = useParams();
  return id ? <OpenTrade id={id} /> : <StartTrade />;
};
