import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Notice, Page } from "../components/Chrome.jsx";
import { useViewer } from "../viewer.jsx";
import { asText, since, tierOf, typeOf } from "../market-view.js";
import { Detail, Gold, Sigil, WeaponMark, whole } from "../components/Item.jsx";

/**
 * Rarity is the one saturated thing on the site, and it means the same here as
 * it does on a board: the ladder the game's own Rarity table authors.
 */
const PAGE_SIZE = 12;
const EMPTY_FACETS = { types: [], rarities: [], heroes: [] };

/** A page of the bag. Twenty-four tiles is a screenful, not a scroll. */
const BAG_PAGE_SIZE = 24;

/**
 * What the bag's search answers to: the weapon's name, its kind, and what has
 * been rolled onto it — the words somebody hunts a weapon by, which is the
 * same list the market board's own search takes from the game server.
 */
const wantedBy = (item, wanted) => {
  const hay = [
    item.name,
    typeOf(item.mastertype),
    ...(item.modifiers ?? []).map((modifier) => `${modifier.name} ${modifier.description ?? ""}`),
    ...(item.legendary ? [`${item.legendary.name} ${item.legendary.description ?? ""}`] : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(wanted);
};

/*
 * The copy button, drawn as the corner mark it is rather than a word in the
 * deal panel. The one thing a trade site is asked for outside itself: paste
 * this card into a chat and ask whether it is worth the money. It answers
 * with its own colour for a moment — a word would have needed a column.
 */const CopyMark = ({ listing }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(asText(listing));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A browser that refuses the clipboard is not worth an error message.
    }
  };

  return (
    <button
      type="button"
      className={`item__copy${copied ? " item__copy--did" : ""}`}
      title={copied ? "copied" : "copy"}
      aria-label={copied ? "copied" : "copy this card"}
      onClick={copy}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <rect x="5.5" y="5.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" />
          <path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1" fill="none" stroke="currentColor" />
        </svg>
      )}
    </button>
  );
};

/**
 * The same weapon on one line, for the lists that are an aside rather than the
 * page: your own stall, and what has sold. The full card is for choosing
 * between things; here you already know which one it is — the mark at the
 * left of the name is the whole of its picture.
 */
const Line = ({ listing }) => (
  <>
    <WeaponMark listing={listing} small />
    <span className={`title title--${tierOf(listing.rarity)}`}>
      {listing.name ?? `item ${listing.item_id}`}
    </span>
    {listing.power ? <span className="table__quiet"> · power {listing.power}</span> : null}
  </>
);

/**
 * The right of the three: what it costs.
 *
 * Its own panel rather than things loose at the end of the row. Down a list of
 * twenty, the price has to land in the same place every time or the column
 * cannot be read at all. The doing of it — the Buy button — lives at the
 * card's foot, in `stock__meta`, not here.
 */
const Deal = ({ listing }) => (
  <div className="deal">
    <span className="deal__label">Asking price</span>
    <span className="deal__price">
      <Gold>{listing.price}</Gold>
      <span className="deal__currency">gold</span>
    </span>
  </div>
);

/**
 * The one action, at the card's bottom-right corner.
 *
 * Gold leaving in one click is one click too easy — a slip on the button
 * under the finger while scrolling spends real gold. So the press is a
 * decision made twice: the first click arms, the same button answers
 * "Confirm" in the danger's colour, and three seconds of silence disarms.
 */
const BuyButton = ({ canBuy, onBuy }) => {
  const [arming, setArming] = useState(false);

  const act = () => {
    if (!arming) {
      setArming(true);
      setTimeout(() => setArming(false), 3000);
      return;
    }
    setArming(false);
    onBuy();
  };

  return (
    <Button kind={arming ? "danger" : undefined} disabled={!canBuy} onClick={act}>
      {arming ? "Confirm" : "Buy"}
    </Button>
  );
};

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

  const [market, setMarket] = useState(null);
  const [stall, setStall] = useState(null);
  const [bag, setBag] = useState(null);
  const [filters, setFilters] = useState({
    q: "",
    type: "",
    rarity: "",
    hero: "",
    maxPrice: "",
    sort: "newest",
  });
  const [page, setPage] = useState(0);
  const [loadingMarket, setLoadingMarket] = useState(false);
  const [marketFailed, setMarketFailed] = useState(false);
  const [problem, setProblem] = useState("");
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(0);
  /*
   * The page's two halves, chosen at the top right: browsing what everybody
   * has put up, or putting one up yourself. Signed out there is only the one
   * half, so the switch is not drawn at all.
   */
  const [mode, setMode] = useState("buy");
  const listings = market?.listings ?? null;
  const total = Number(market?.total ?? 0);
  const facets = market?.facets ?? EMPTY_FACETS;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const browsing = !playing || mode === "buy";

  /*
   * Two reads, not one. The board has to be read again whenever the filters
   * move — that is what the filters are for — but the stall and the bag do
   * not care about them, and fetching both on every keystroke asked the game
   * server to answer the same question thirty times. The board is never
   * cached on purpose: the server's answer is the one that is true, and a
   * cached market is one that sells what somebody already bought.
   */
  const refreshMarket = useCallback(async () => {
    setLoadingMarket(true);
    try {
      const board = await api.market({
        ...filters,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setMarket(board);
      setMarketFailed(false);

      if (page > 0 && !(board.listings ?? []).length && Number(board.total) > 0) {
        setPage(Math.max(0, Math.ceil(Number(board.total) / PAGE_SIZE) - 1));
      }
    } catch (failure) {
      setMarketFailed(true);
      setProblem(failure instanceof ApiError ? failure.message : "Could not load the market.");
      throw failure;
    } finally {
      setLoadingMarket(false);
    }
  }, [filters, page]);

  const refreshStall = useCallback(async () => {
    if (!playing) {
      setStall(null);
      setBag(null);
      return;
    }
    try {
      const [nextStall, nextBag] = await Promise.all([api.stall(), api.inventory()]);
      setStall(nextStall);
      setBag(nextBag);
    } catch (failure) {
      setProblem(
        failure instanceof ApiError ? failure.message : "Could not load your stall."
      );
    }
  }, [playing]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => refreshMarket().catch(() => undefined), filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [ready, refreshMarket]);

  useEffect(() => {
    if (!ready) return;
    refreshStall();
  }, [ready, refreshStall]);

  const changeFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(0);
  };

  const clearFilters = () => {
    setFilters({ q: "", type: "", rarity: "", hero: "", maxPrice: "", sort: "newest" });
    setPage(0);
  };

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
      await Promise.all([refreshMarket(), refreshStall()]);
      return true;
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      if (failure instanceof ApiError && failure.status === 410) {
        await Promise.all([refreshMarket(), refreshStall()]);
      }
      return false;
    } finally {
      setBusy((count) => count - 1);
    }
  };

  return (
    <Page where="Market">
      <div className="board-head">
        <h2>Market</h2>
        <span className="board-head__where">
          {market === null
            ? "…"
            : total === 1
              ? "one match"
              : `${whole.format(total)} matches${loadingMarket ? " · refreshing" : ""}`}
        </span>
        {playing ? (
          <div className="mode">
            <button
              type="button"
              className={`mode__opt${mode === "buy" ? " mode__opt--on" : ""}`}
              aria-pressed={mode === "buy"}
              onClick={() => setMode("buy")}
            >
              Buy
            </button>
            <button
              type="button"
              className={`mode__opt${mode === "sell" ? " mode__opt--on" : ""}`}
              aria-pressed={mode === "sell"}
              onClick={() => setMode("sell")}
            >
              Sell
            </button>
          </div>
        ) : null}
      </div>

      <Notice kind="bad">{problem}</Notice>
      <Notice kind="good">{said}</Notice>

      {playing && mode === "sell" ? (
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
      ) : null}

      {!playing ? (
        <Box title="Your Stall">
          <p className="wait">
            {ready && viewer
              ? "Confirm your address to buy and sell."
              : "Sign in to buy and sell."}
          </p>
        </Box>
      ) : null}

      {browsing ? (
        <Box title="Find A Weapon">
          <form className="market-filters" onSubmit={(event) => event.preventDefault()}>
            <label className="market-filter market-filter--search">
              <span>Search</span>
              <input
                className="field__input"
                type="search"
                value={filters.q}
                placeholder="name, seller, attack or modifier"
                maxLength={64}
                onChange={(event) => changeFilter("q", event.target.value)}
              />
            </label>
            <label className="market-filter">
              <span>Weapon type</span>
              <select value={filters.type} onChange={(event) => changeFilter("type", event.target.value)}>
                <option value="">all types</option>
                {facets.types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.name} ({type.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="market-filter">
              <span>Rarity</span>
              <select value={filters.rarity} onChange={(event) => changeFilter("rarity", event.target.value)}>
                <option value="">all rarities</option>
                {facets.rarities.map((rarity) => (
                  <option key={rarity.value} value={rarity.value}>
                    {rarity.name ?? tierOf(rarity.value)} ({rarity.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="market-filter">
              <span>Usable by</span>
              <select value={filters.hero} onChange={(event) => changeFilter("hero", event.target.value)}>
                <option value="">any hero</option>
                {facets.heroes.map((hero) => (
                  <option key={hero.value} value={hero.value}>
                    {hero.name} ({hero.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="market-filter">
              <span>Maximum price</span>
              <input
                className="field__input field__input--narrow"
                type="number"
                min="1"
                max="2000000000"
                step="1"
                value={filters.maxPrice}
                placeholder="any"
                onChange={(event) => changeFilter("maxPrice", event.target.value)}
              />
            </label>
            <label className="market-filter">
              <span>Order</span>
              <select value={filters.sort} onChange={(event) => changeFilter("sort", event.target.value)}>
                <option value="newest">newest first</option>
                <option value="price_asc">price: low to high</option>
                <option value="price_desc">price: high to low</option>
                <option value="power_desc">power: high to low</option>
                <option value="level_asc">level: low to high</option>
              </select>
            </label>
            {Object.entries(filters).some(([name, value]) => value && !(name === "sort" && value === "newest")) ? (
              <button className="link market-filter__clear" type="button" onClick={clearFilters}>
                clear filters
              </button>
            ) : null}
          </form>
        </Box>
      ) : null}

      {browsing ? (
        <Box title="For Sale" more={total ? `${whole.format(total)} found` : null} flush>
          {market === null && !marketFailed ? (
            <p className="table__empty">Loading…</p>
          ) : marketFailed && market === null ? (
            <p className="table__empty">The market is not answering.</p>
          ) : !listings.length ? (
            <p className="table__empty">
              {Object.values(filters).some((value) => value && value !== "newest")
                ? "No weapon matches these filters."
                : "Nobody has anything up for sale."}
            </p>
          ) : (
            <>
              <ul className="stock">
                {listings.map((listing) => {
                  const mine = listing.seller_id === viewer?.accountId;
                  return (
                  <li className="stock__row" key={listing.id}>
                    <CopyMark listing={listing} />
                    <Sigil listing={listing} />
                    <Detail listing={listing} />
                    {/* The price column, as one column: the card, the action,
                        and the seller line share its height, so nothing hangs
                        below the item text to pull the card taller. */}
                    <div className="stock__side">
                      <Deal listing={listing} />
                      <div className="stock__buy">
                        {mine ? null : (
                          <BuyButton
                            canBuy={playing && busy === 0}
                            onBuy={() => doing(() => api.buyListing(listing.id), "Bought.")}
                          />
                        )}
                      </div>
                      <div className="stock__meta">
                        {mine ? (
                          <em>your listing</em>
                        ) : (
                          <Link to={`/player/${encodeURIComponent(listing.seller_name)}`}>
                            {listing.seller_name}
                          </Link>
                        )}
                        {since(listing.listed_at) ? (
                          <span className="stock__when"> · {since(listing.listed_at)}</span>
                        ) : null}
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ul>
              {pageCount > 1 ? (
                <div className="market-pager">
                  <Button disabled={page === 0 || loadingMarket} onClick={() => setPage((value) => value - 1)}>
                    Previous
                  </Button>
                  <span>
                    Page {page + 1} of {pageCount}
                  </span>
                  <Button
                    disabled={page + 1 >= pageCount || loadingMarket}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </Box>
      ) : null}

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

/**
 * One weapon in the bag, drawn the way an inventory draws one: a tile with the
 * weapon's own icon on it, the frame wearing the rarity.
 *
 * Hovering (or tabbing to) the tile reads its stats in a tooltip; clicking
 * chooses it for the listing, and the chosen weapon's full card is laid out
 * under the grid. A select could do neither — it cannot show a picture at all,
 * and a bag of thirty reads as one long sentence of names and powers.
 */
const Slot = ({ item, chosen, onChoose }) => {
  const tier = tierOf(item.rarity);
  return (
    <div className="bag__slot">
      <button
        type="button"
        className={`bag__tile bag__tile--${tier}${chosen ? " bag__tile--chosen" : ""}`}
        aria-pressed={chosen}
        onClick={() => onChoose(item.id)}
      >
        <WeaponMark listing={item} />
        <span className={`bag__tile-name title title--${tier}`}>
          {item.name ?? `item ${item.item_id}`}
        </span>
        {item.power ? (
          <span className="bag__tile-power">{whole.format(item.power)} power</span>
        ) : null}
      </button>
      <div className="bag__tip">
        <Detail listing={item} />
      </div>
    </div>
  );
};

/** Your own side of it: what is up, what sold, and the form to put one more up. */
const Stall = ({ stall, bag, busy, onList, onCancel, onClaim }) => {
  const [itemId, setItemId] = useState("");
  const [price, setPrice] = useState("");
  const [wanted, setWanted] = useState("");
  const [bagPage, setBagPage] = useState(0);

  const offerable = bag?.items ?? [];
  const owed = Number(stall?.owed ?? 0);
  const selected = offerable.find((item) => Number(item.id) === Number(itemId));

  /*
   * The bag is searched and paged here rather than on the server: it is this
   * account's own unequipped weapons, already read whole for the gold count,
   * and asking the game server to re-read it on every keystroke buys nothing.
   */
  const needle = wanted.trim().toLowerCase();
  const matches = needle ? offerable.filter((item) => wantedBy(item, needle)) : offerable;
  const bagPages = Math.max(1, Math.ceil(matches.length / BAG_PAGE_SIZE));
  const page = Math.min(bagPage, bagPages - 1);
  const shown = matches.slice(page * BAG_PAGE_SIZE, (page + 1) * BAG_PAGE_SIZE);

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
              <li key={listing.id} className="mini__slot">
                <span className="mini__nm">
                  <Line listing={listing} />
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
                {/* The row is the name and the price; the card is what the
                    row is of. Hovering reads it, stacked above the rows under
                    it rather than under the one it came from. */}
                <div className="bag__tip">
                  <Detail listing={listing} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {stall?.sold?.length ? (
          <ul className="mini mini--sold" style={{ marginTop: "0.5rem" }}>
            {stall.sold.map((listing) => (
              <li key={listing.id}>
                <span className="mini__nm"><Line listing={listing} /></span>
                <span className="mini__vl"><Gold>{listing.price}</Gold></span>
                <span className="table__quiet">sold</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Box>

      <Box
        title="Put One Up"
        more={
          bag
            ? needle
              ? `${whole.format(matches.length)} of ${whole.format(offerable.length)} in the bag`
              : `${whole.format(offerable.length)} in the bag`
            : null
        }
      >
        {!offerable.length ? (
          <p className="wait" style={{ margin: 0 }}>
            Nothing unequipped to sell. A weapon in a hand has to come off first.
          </p>
        ) : (
          <form
            className="listing-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onList(Number(itemId), Number(price))) {
                setItemId("");
                setPrice("");
              }
            }}
          >
            <div className="bag-head">
              <input
                className="field__input"
                type="search"
                value={wanted}
                placeholder="search the bag — name, type, modifier"
                maxLength={64}
                onChange={(event) => {
                  setWanted(event.target.value);
                  setBagPage(0);
                }}
              />
            </div>
            {matches.length ? (
              <div className="bag">
                {shown.map((item) => (
                  <Slot
                    key={item.id}
                    item={item}
                    chosen={Number(item.id) === Number(itemId)}
                    onChoose={setItemId}
                  />
                ))}
              </div>
            ) : (
              <p className="table__empty" style={{ margin: 0 }}>
                Nothing in the bag is called that.
              </p>
            )}
            {bagPages > 1 ? (
              <div className="market-pager bag-pager">
                <Button disabled={page === 0} onClick={() => setBagPage((value) => Math.max(0, value - 1))}>
                  Previous
                </Button>
                <span>
                  Page {page + 1} of {bagPages}
                </span>
                <Button
                  disabled={page + 1 >= bagPages}
                  onClick={() => setBagPage((value) => Math.min(bagPages - 1, value + 1))}
                >
                  Next
                </Button>
              </div>
            ) : null}
            <div className="listing-form__row">
              <label htmlFor="price">Price</label>
              <input
                id="price"
                className="field__input field__input--narrow"
                type="number"
                min="1"
                max="2000000000"
                step="1"
                required
                disabled={!itemId}
                value={price}
                placeholder="gold"
                onChange={(event) => setPrice(event.target.value)}
              />
              <Button type="submit" disabled={busy || !itemId || !price}>
                Put up
              </Button>
            </div>
            {selected ? (
              <div className="listing-form__preview">
                <Detail listing={selected} />
                {selected.vendor_value ? (
                  <p className="footnote">
                    The game shop would pay <Gold>{selected.vendor_value}</Gold>; your market price is your choice.
                  </p>
                ) : null}
              </div>
            ) : null}
          </form>
        )}
      </Box>
    </>
  );
};
