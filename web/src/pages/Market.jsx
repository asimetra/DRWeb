import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Notice, Page } from "../components/Chrome.jsx";
import { useViewer } from "../viewer.jsx";

const whole = new Intl.NumberFormat("en-GB");

/**
 * Rarity is the one saturated thing on the site, and it means the same here as
 * it does on a board: the ladder the game's own Rarity table authors.
 */
const TIERS = ["common", "uncommon", "rare", "legendary"];
const tierOf = (rarity) => TIERS[Math.max(0, Math.min(3, Number(rarity ?? 0)))] ?? "common";

/**
 * What a weapon is: the line that names it, and under it the lines somebody
 * actually buys it for.
 *
 * Every word is the game server's answer. A modifier is stored as a number and
 * this side holds no game data to turn 70211 into "Chargey", so a listing
 * arrives already carrying the name and what it does — see `describeListings`.
 * An item with none has nothing underneath, which is most of them.
 */
const Weapon = ({ listing }) => {
  const modifiers = listing.modifiers ?? [];
  return (
    <span className="weapon">
      <span className={`title title--${tierOf(listing.rarity)}`}>
        {listing.name ?? `item ${listing.item_id}`}
      </span>
      {listing.power ? <span className="table__quiet"> · power {listing.power}</span> : null}
      {listing.requiredlevel ? (
        <span className="table__quiet"> · level {listing.requiredlevel}</span>
      ) : null}

      {modifiers.length || listing.legendary ? (
        <span className="weapon__mods">
          {modifiers.map((modifier) => (
            <span className="weapon__mod" key={modifier.id}>
              {modifier.description ?? modifier.name}
            </span>
          ))}
          {/* Set apart the way the game sets it apart: the third one, which
              only the top rarity carries. */}
          {listing.legendary ? (
            <span className="weapon__mod weapon__mod--legendary">
              {listing.legendary.description ?? listing.legendary.name}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
};

const Gold = ({ children }) => (
  <span className="gold">{whole.format(Number(children ?? 0))}</span>
);

/**
 * The market: everything up, and your own stall beside it.
 *
 * A listing is not a conversation. Nobody has to be online at the same time as
 * anybody else — you put a weapon up and walk away, and the gold is waiting
 * when you next look. That is the whole reason this replaced a trade window on
 * a server whose players are not all awake at once.
 */
export const Market = () => {
  const { viewer, ready } = useViewer();
  const playing = Boolean(ready && viewer?.accountId);

  const [listings, setListings] = useState(null);
  const [stall, setStall] = useState(null);
  const [bag, setBag] = useState(null);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(0);

  const refresh = useCallback(async () => {
    const board = await api.market().catch(() => ({ listings: [] }));
    setListings(board.listings ?? []);
    if (!playing) return;
    setStall(await api.stall().catch(() => null));
    setBag(await api.inventory().catch(() => null));
  }, [playing]);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [ready, refresh]);

  /*
   * Every action is the same shape: try it, say what happened, and read the
   * market back. Reading back rather than patching the list in place is
   * deliberate — somebody else may have bought the row underneath you, and the
   * server's answer is the one that is true.
   */
  const doing = async (what, said_) => {
    setProblem("");
    setSaid("");
    setBusy((count) => count + 1);
    try {
      await what();
      setSaid(said_);
      await refresh();
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      if (failure instanceof ApiError && failure.status === 410) await refresh();
    } finally {
      setBusy((count) => count - 1);
    }
  };

  return (
    <Page where="Market">
      <div className="board-head">
        <h2>Market</h2>
        <span className="board-head__where">
          {listings === null
            ? "…"
            : listings.length === 1
              ? "one weapon up"
              : `${whole.format(listings.length)} weapons up`}
        </span>
      </div>

      <Notice kind="bad">{problem}</Notice>
      <Notice kind="good">{said}</Notice>

      {playing ? (
        <Stall
          stall={stall}
          bag={bag}
          busy={busy > 0}
          onList={(itemId, price) =>
            doing(() => api.listForSale(itemId, price), "Put up for sale.")
          }
          onCancel={(id) => doing(() => api.cancelListing(id), "Taken back down.")}
          onClaim={() => doing(() => api.claimProceeds(), "Collected.")}
        />
      ) : (
        <Box title="Your Stall">
          <p className="wait">
            {ready && viewer
              ? "Confirm your address to buy and sell."
              : "Sign in to buy and sell."}
          </p>
        </Box>
      )}

      <Box title="For Sale" more={listings?.length ? `${listings.length} up` : null} flush>
        {listings === null ? (
          <p className="table__empty">Loading…</p>
        ) : !listings.length ? (
          <p className="table__empty">Nobody has anything up for sale.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Weapon</th>
                  <th scope="col">Seller</th>
                  <th className="table__num" scope="col">
                    Price
                  </th>
                  <th scope="col" />
                </tr>
              </thead>
              <tbody>
                {listings.map((listing) => {
                  const mine = listing.seller_id === viewer?.accountId;
                  return (
                    <tr key={listing.id}>
                      <td>
                        <Weapon listing={listing} />
                      </td>
                      <td>{mine ? <em>you</em> : listing.seller_name}</td>
                      <td className="table__num">
                        <Gold>{listing.price}</Gold>
                      </td>
                      <td className="table__num">
                        {mine ? (
                          <span className="table__quiet">yours</span>
                        ) : (
                          <Button
                            disabled={!playing || busy > 0}
                            onClick={() =>
                              doing(() => api.buyListing(listing.id), "Bought.")
                            }
                          >
                            Buy
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title="About The Market">
        <p style={{ marginTop: 0 }}>
          A weapon that is up has left your bag — that is what stops it being
          equipped or sold to the shop while somebody is trying to buy it. Take
          it back down and it returns.
        </p>
        <p style={{ marginBottom: 0 }}>
          Gold from a sale waits at your stall until you collect it, and neither
          listing nor collecting works while you are in a dungeon. A sale itself
          does: your weapon is here rather than in your hand, so somebody can
          buy it while you play.
        </p>
      </Box>
    </Page>
  );
};

/** Your own side of it: what is up, what sold, and the form to put one more up. */
const Stall = ({ stall, bag, busy, onList, onCancel, onClaim }) => {
  const [itemId, setItemId] = useState("");
  const [price, setPrice] = useState("");

  const offerable = bag?.items ?? [];
  const owed = Number(stall?.owed ?? 0);

  return (
    <>
      <Box title="Your Stall" more={bag ? `${whole.format(bag.gold)} gold` : null}>
        {owed ? (
          <div className="claim">
            <span>
              <Gold>{owed}</Gold> waiting from{" "}
              {stall.sold.length === 1 ? "one sale" : `${stall.sold.length} sales`}
            </span>
            <Button disabled={busy} onClick={onClaim}>
              Collect
            </Button>
          </div>
        ) : (
          <p className="wait" style={{ margin: 0 }}>
            Nothing sold yet.
          </p>
        )}

        {stall?.listed?.length ? (
          <ul className="mini" style={{ marginTop: "0.5rem" }}>
            {stall.listed.map((listing) => (
              <li key={listing.id}>
                <span className="mini__nm">
                  <Weapon listing={listing} />
                </span>
                <span className="mini__vl">
                  <Gold>{listing.price}</Gold>
                </span>
                <button
                  className="link"
                  type="button"
                  disabled={busy}
                  onClick={() => onCancel(listing.id)}
                >
                  take down
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Box>

      <Box title="Put One Up">
        {!offerable.length ? (
          <p className="wait" style={{ margin: 0 }}>
            Nothing unequipped to sell. A weapon in a hand has to come off first.
          </p>
        ) : (
          <form
            className="filters"
            onSubmit={(event) => {
              event.preventDefault();
              onList(Number(itemId), Number(price));
              setItemId("");
              setPrice("");
            }}
          >
            <span>
              <label htmlFor="weapon">Weapon</label>
              <select
                id="weapon"
                required
                value={itemId}
                onChange={(event) => setItemId(event.target.value)}
              >
                <option value="">choose one</option>
                {offerable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {[
                      item.name ?? `item ${item.item_id}`,
                      `power ${item.power ?? 0}`,
                      `level ${item.requiredlevel ?? 1}`,
                      ...(item.modifiers ?? []).map((modifier) => modifier.name),
                      ...(item.legendary ? [`★ ${item.legendary.name}`] : []),
                    ].join(" · ")}
                  </option>
                ))}
              </select>
            </span>
            <span>
              <label htmlFor="price">Price</label>
              <input
                id="price"
                className="field__input field__input--narrow"
                type="number"
                min="1"
                step="1"
                required
                value={price}
                placeholder="gold"
                onChange={(event) => setPrice(event.target.value)}
              />
            </span>
            <Buttons>
              <Button type="submit" disabled={busy || !itemId || !price}>
                Put up
              </Button>
            </Buttons>
          </form>
        )}
      </Box>
    </>
  );
};
