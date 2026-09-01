import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Button, Buttons, Notice, Page } from "../components/Chrome.jsx";
import { useViewer } from "../viewer.jsx";
import { asText, since, tierOf, typeOf } from "../market-view.js";

/**
 * Where a deployment serves the weapon icons it exported for itself. The game
 * server's own content route: these are the game's art, so unlike the hero
 * portraits they are not in this repository and not in this bundle.
 */
const WEAPON_ICONS = "/content/Resources/Art2D/Icons/Weapons/";

const whole = new Intl.NumberFormat("en-GB");

/**
 * Rarity is the one saturated thing on the site, and it means the same here as
 * it does on a board: the ladder the game's own Rarity table authors.
 */
const PAGE_SIZE = 12;
const EMPTY_FACETS = { types: [], rarities: [], heroes: [] };

/**
 * The whole item, read downwards: what it is, what it is worth swinging, and
 * what has been rolled onto it.
 *
 * Stacked rather than run together on one line because that is how it is read
 * — nobody compares two weapons by scanning a sentence — and the order is the
 * order somebody decides in: is this my kind of weapon, is it strong enough,
 * can I use it, what does it do.
 *
 * Every word is the game server's answer. A modifier is a number in the row
 * and this side holds no game data to turn 70211 into "Chargey", which is the
 * arrangement the pair is built on. See `describeListings`.
 */
const Detail = ({ listing }) => {
  const modifiers = listing.modifiers ?? [];
  const weapon = listing.weapon;
  return (
    <div className="item">
      <div className={`item__name title--${tierOf(listing.rarity)}`}>
        {listing.name ?? `item ${listing.item_id}`}
      </div>
      {listing.mastertype ? (
        <div className="item__type">
          {typeOf(listing.mastertype)}
          {weapon?.classType ? ` · ${weapon.classType.toLowerCase()}` : ""}
        </div>
      ) : null}
      {listing.usable_by?.length ? (
        <div className="item__fits">
          For {listing.usable_by.map((hero) => hero.name).join(", ")}
        </div>
      ) : null}

      <dl className="item__stats">
        {listing.power ? (
          <>
            <dt>Power</dt>
            <dd>{whole.format(listing.power)}</dd>
          </>
        ) : null}
        {weapon?.speed ? (
          <>
            <dt>Speed</dt>
            <dd>{weapon.speed.toLowerCase()}</dd>
          </>
        ) : null}
        {listing.requiredlevel ? (
          <>
            <dt>Level</dt>
            <dd>{listing.requiredlevel}</dd>
          </>
        ) : null}
        {listing.vendor_value ? (
          <>
            <dt>Shop value</dt>
            <dd>{whole.format(listing.vendor_value)}</dd>
          </>
        ) : null}
      </dl>

      {/* Its two attacks, which are the weapon rather than the roll: every
          Hand Axe has these and no two weapon types share them. */}
      {weapon?.tap?.title || weapon?.hold?.title ? (
        <div className="item__attacks">
          {weapon.tap?.title ? (
            <div className="item__attack">
              <span className="item__attack-name">{weapon.tap.title}</span>
              {weapon.tap.description ? <p>{weapon.tap.description}</p> : null}
            </div>
          ) : null}
          {weapon.hold?.title ? (
            <div className="item__attack">
              <span className="item__attack-name">{weapon.hold.title}</span>
              {weapon.hold.manaCost ? (
                <span className="item__mana"> · {weapon.hold.manaCost} mana</span>
              ) : null}
              {weapon.hold.description ? <p>{weapon.hold.description}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {modifiers.length || listing.legendary ? (
        <div className="item__mods">
          {modifiers.map((modifier) => (
            <div className="item__mod" key={modifier.id}>
              {modifier.description ?? modifier.name}
            </div>
          ))}
          {/* Apart, the way the game keeps it apart: only the top rarity
              carries a third, and it is the line that weapon is bought for. */}
          {listing.legendary ? (
            <div className="item__mod item__mod--legendary">
              {listing.legendary.description ?? listing.legendary.name}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

/**
 * The same weapon on one line, for the lists that are an aside rather than the
 * page: your own stall, and what has sold. The full card is for choosing
 * between things; here you already know which one it is.
 */
const Line = ({ listing }) => (
  <>
    <span className={`title title--${tierOf(listing.rarity)}`}>
      {listing.name ?? `item ${listing.item_id}`}
    </span>
    {listing.power ? <span className="table__quiet"> · power {listing.power}</span> : null}
  </>
);

const Gold = ({ children }) => (
  <span className="gold">{whole.format(Number(children ?? 0))}</span>
);

/**
 * The left of the three, where a trade site puts the item's picture.
 *
 * The picture is the weapon's own icon when the deployment has exported one,
 * and its type and rarity in words when it has not — neither is a placeholder
 * for the other. Nothing ships an icon: the art belongs to the game, so a
 * deployment reads it out of a copy of the game with the server's
 * tools/export-icons.js and serves it from /content/. A site that never runs
 * that still has a frame worth looking at.
 *
 * The frame wears the rarity either way, which is the same ladder the rank
 * colours and the title tiers use.
 */
const Sigil = ({ listing }) => {
  const tier = tierOf(listing.rarity);
  const type = typeOf(listing.mastertype);
  /*
   * The weapon's own icon when the deployment has it. Nothing ships one — see
   * the server's tools/export-icons.js — so the frame has to stand on its own
   * either way, and the initials stay underneath as what shows when it cannot
   * be loaded rather than as a placeholder that gets replaced.
   */
  const icon = listing.icon ? `${WEAPON_ICONS}${listing.icon}.png` : null;
  return (
    <div className={`sigil sigil--${tier}`}>
      <span
        className={icon ? "sigil__mark sigil__mark--art" : "sigil__mark"}
        aria-hidden="true"
        style={icon ? { backgroundImage: `url(${icon})` } : undefined}
      >
        {icon ? "" : (type || "?").slice(0, 2).toUpperCase()}
      </span>
      <span className="sigil__type">{type || "weapon"}</span>
      {/* Not `title--${tier}`. A saturated word in a small box reads as an
          indicator lamp rather than a rarity — the frame around it already
          carries the colour, and the ladder's saturation is spent on titles
          and item names, which is where it means something. */}
      <span className="sigil__tier">{tier}</span>
    </div>
  );
};

/**
 * The right of the three: what it costs, who is asking, and what you can do.
 *
 * Its own panel rather than three things loose at the end of the row. Down a
 * list of twenty, the price has to land in the same place every time or the
 * column cannot be read at all — and the seller belongs under the price rather
 * than above it, because the number is what the eye is scanning for and the
 * name is what it checks once it has stopped.
 */
const Deal = ({ listing, mine, canBuy, onBuy }) => {
  const [copied, setCopied] = useState(false);
  const listed = since(listing.listed_at);

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
    <div className="deal">
      <span className="deal__label">Asking price</span>
      <span className="deal__price">
        <Gold>{listing.price}</Gold>
        <span className="deal__currency">gold</span>
      </span>

      <span className="deal__seller">
        {/* A name is a way in. Somebody deciding whether to spend on a weapon
            wants to know who is selling it, and that question arrives in the
            middle of another one — so it is answered without leaving. */}
        {mine ? (
          <em>your listing</em>
        ) : (
          <Link to={`/player/${encodeURIComponent(listing.seller_name)}`}>
            {listing.seller_name}
          </Link>
        )}
        {listed ? <span className="deal__when"> · {listed}</span> : null}
      </span>

      <div className="deal__acts">
        {mine ? null : (
          <Button disabled={!canBuy} onClick={onBuy}>
            Buy
          </Button>
        )}
        {/* The one thing a trade site is asked for outside itself: paste this
            into a chat and ask whether it is worth the money. */}
        <button className="link deal__copy" type="button" onClick={copy}>
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
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
  const listings = market?.listings ?? null;
  const total = Number(market?.total ?? 0);
  const facets = market?.facets ?? EMPTY_FACETS;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refresh = useCallback(async () => {
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
  }, [filters, page, playing]);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => refresh().catch(() => undefined), filters.q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [ready, refresh]);

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
      await refresh();
      return true;
    } catch (failure) {
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.");
      if (failure instanceof ApiError && failure.status === 410) await refresh();
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
                    <Sigil listing={listing} />
                    <Detail listing={listing} />
                    <Deal
                      listing={listing}
                      mine={mine}
                      canBuy={playing && busy === 0}
                      onBuy={() => doing(() => api.buyListing(listing.id), "Bought.")}
                    />
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
  const selected = offerable.find((item) => Number(item.id) === Number(itemId));

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

      <Box title="Put One Up">
        {!offerable.length ? (
          <p className="wait" style={{ margin: 0 }}>
            Nothing unequipped to sell. A weapon in a hand has to come off first.
          </p>
        ) : (
          <form
            className="filters listing-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (await onList(Number(itemId), Number(price))) {
                setItemId("");
                setPrice("");
              }
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
                max="2000000000"
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
