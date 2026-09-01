import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api.js";
import { Box, Button, Notice, Page } from "../components/Chrome.jsx";
import { Detail, Gold, Sigil, WeaponMark, whole } from "../components/Item.jsx";
import { dayLabel, dayOf, opensLabel, until } from "../shop-view.js";
import { tierOf } from "../market-view.js";

/**
 * The shop, which is not the market.
 *
 * The market next door is other players, and everything on it is somebody's
 * decision. This is the game's own shelf: twenty-two weapons at a fixed price
 * that turn over at nine every morning, on a schedule written into the game's
 * tables months in advance. Nobody negotiates with it and nothing on it is
 * owned, so there is nothing here to sign in for.
 *
 * Nothing is bought here either. A weapon is bought in the client, against the
 * account it is logged in as; a website that could spend somebody's gold is a
 * different and much larger question, and this page asks none of it. What it is
 * for is the two questions the game's own shop screen cannot answer: what is up
 * tomorrow, and when is the one I want coming back.
 */

/** As far ahead as the rail reaches in one go. Two weeks is a plan; a month is a list. */
const RAIL_DAYS = 14;
const SCHEDULE_PAGE = 40;

/**
 * The clock, ticking on its own.
 *
 * Its own component because it is the only thing on the page that changes by
 * itself, and re-rendering twenty-two cards once a minute to move two digits
 * would be paying for the whole page to watch one number.
 */
const Countdown = ({ closesAt }) => {
  const [left, setLeft] = useState(() => until(closesAt));

  useEffect(() => {
    setLeft(until(closesAt));
    const tick = setInterval(() => setLeft(until(closesAt)), 30_000);
    return () => clearInterval(tick);
  }, [closesAt]);

  return left ? <>changes in {left}</> : null;
};

/**
 * The days, as a row of doors rather than a date field.
 *
 * A calendar would be the obvious control and the wrong one: the schedule runs
 * four months and nobody is looking for the 14th of November, they are looking
 * a few days ahead and then further if nothing good is close. So the days are
 * laid out in the order they happen and the rail scrolls.
 */
const Rail = ({ days, chosen, today, onChoose }) => (
  <div className="rail" role="tablist" aria-label="Which day">
    {/* Followed from the schedule, a day can be months from here and the rail
        moves with it. The way back has to be on screen when that happens, or
        the reader is somewhere in November with no route home. */}
    {days.includes(today) ? null : (
      <button type="button" className="rail__day rail__day--back" onClick={() => onChoose(today)}>
        ← today
      </button>
    )}
    {days.map((day) => (
      <button
        key={day}
        type="button"
        role="tab"
        aria-selected={day === chosen}
        className={`rail__day${day === chosen ? " rail__day--now" : ""}${
          day === today ? " rail__day--today" : ""
        }`}
        onClick={() => onChoose(day)}
      >
        {dayLabel(day)}
      </button>
    ))}
  </div>
);

/**
 * What the game is asking for it.
 *
 * The market's panel next door carries a seller, a time and a Buy button
 * because all three are questions there. Here the price is the whole of it:
 * it is the same for everybody, it does not move, and the answer to "can I
 * afford it" is somewhere else entirely.
 */
const Asking = ({ offer }) => (
  <div className="asking">
    <span className="asking__label">Price</span>
    <span className="asking__price">
      <Gold>{offer.price}</Gold>
      <span className="asking__currency">{offer.currency === "PREMIUM" ? "gems" : "gold"}</span>
    </span>
    {offer.vendor_value ? (
      <span className="asking__back">
        sells back for {whole.format(offer.vendor_value)}
      </span>
    ) : null}
  </div>
);

/**
 * One rarity's worth of the day's shelf, under its own heading.
 *
 * Grouped rather than run together because the shelf is read in exactly one
 * order — is there a legendary today, is either rare worth it, and then the
 * nineteen underneath are scrolled past. A flat list of twenty-two makes
 * somebody find that out for themselves every time.
 */
const Shelf = ({ tier, offers }) => (
  <>
    <li className={`shelf__band shelf__band--${tier}`} aria-hidden="true">
      <span>{tier}</span>
      <span className="shelf__count">{offers.length}</span>
    </li>
    {offers.map((offer) => (
      <li className="stock__row" key={offer.offer_id}>
        <Sigil listing={offer} />
        <Detail listing={offer} />
        <Asking offer={offer} />
      </li>
    ))}
  </>
);

const TIERS = ["legendary", "rare", "uncommon", "common"];

/** One line of the answer to "when is this coming". */
const Coming = ({ offer, onDay }) => (
  <li className="coming">
    <button type="button" className="coming__day" onClick={() => onDay(offer.day)}>
      {dayLabel(offer.day)}
    </button>
    <span className="coming__what">
      <WeaponMark listing={offer} small />
      <span className={`title title--${tierOf(offer.rarity)}`}>{offer.name}</span>
    </span>
    <span className="coming__level">level {offer.requiredlevel}</span>
    <span className="coming__power">{whole.format(offer.power)} power</span>
    <span className="coming__price">
      <Gold>{offer.price}</Gold>
    </span>
  </li>
);

export const Shop = () => {
  const [day, setDay] = useState("");
  const [shop, setShop] = useState(null);
  const [problem, setProblem] = useState("");

  const [wanted, setWanted] = useState("");
  const [rarity, setRarity] = useState("");
  const [page, setPage] = useState(0);
  const [coming, setComing] = useState(null);

  useEffect(() => {
    let stale = false;
    api
      .shop({ day, days: RAIL_DAYS })
      .then((answer) => {
        if (stale) return;
        setShop(answer);
        setProblem("");
      })
      .catch((failure) => {
        if (stale) return;
        setProblem(
          failure instanceof ApiError ? failure.message : "The shop is not answering."
        );
      });
    return () => {
      stale = true;
    };
  }, [day]);

  /* The schedule is a second question and asks it separately: somebody typing a
     weapon's name is not also asking for the day's shelf to be fetched again.

     Unsearched, it starts tomorrow. Today's twenty-two are on the shelf a
     screen above, and listing them again is twenty-two rows of nothing new
     before the first day the reader came here for. Searched, it starts today,
     because "it is on today" is the best answer that question can have. */
  const askSchedule = useCallback(() => {
    let stale = false;
    api
      .shopSchedule({
        q: wanted.trim(),
        rarity,
        from: wanted.trim() ? "" : dayOf(Date.now() + 86_400_000),
        limit: SCHEDULE_PAGE,
        offset: page * SCHEDULE_PAGE,
      })
      .then((answer) => {
        if (!stale) setComing(answer);
      })
      .catch(() => {
        if (!stale) setComing(null);
      });
    return () => {
      stale = true;
    };
  }, [wanted, rarity, page]);

  useEffect(() => {
    const timer = setTimeout(askSchedule, wanted ? 250 : 0);
    return () => clearTimeout(timer);
  }, [askSchedule, wanted]);

  const offers = shop?.offers ?? [];
  const shelves = TIERS.map((tier) => [
    tier,
    offers.filter((offer) => tierOf(offer.rarity) === tier),
  ]).filter(([, stock]) => stock.length);

  const results = coming?.results ?? [];
  const pages = Math.max(1, Math.ceil(Number(coming?.total ?? 0) / SCHEDULE_PAGE));

  /* Choosing a day from the schedule is choosing it on the rail, which is the
     same thing said twice — so it scrolls back up rather than opening a second
     view of the same shelf. */
  const openDay = (which) => {
    setDay(which);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <Page where="Shop">
      <div className="board-head">
        <h2>Shop</h2>
        <span className="board-head__where">
          {/* The countdown belongs to the shelf that is actually on. Pointed at
              a day in October it counted down eleven hundred hours, which is
              not a fact anybody was asking for — that day's line is when it
              goes up, not how long until it goes away. */}
          {!shop ? (
            "…"
          ) : shop.day === shop.today ? (
            <Countdown closesAt={shop.closes_at} />
          ) : (
            `up at ${opensLabel(shop.opens_at)}, ${dayLabel(shop.day)}`
          )}
        </span>
      </div>

      <Notice kind="bad">{problem}</Notice>

      <Box
        title="On The Shelf"
        more={shop ? `${offers.length} weapons` : null}
        flush
      >
        {shop ? (
          <Rail
            days={shop.days}
            chosen={shop.day}
            today={shop.today}
            onChoose={(which) => setDay(which === shop.today ? "" : which)}
          />
        ) : null}

        {!shop && !problem ? (
          <p className="table__empty">Loading…</p>
        ) : !offers.length ? (
          <p className="table__empty">
            {problem ? "The shop is not answering." : "Nothing is on sale that day."}
          </p>
        ) : (
          <ul className="stock stock--shelf">
            {shelves.map(([tier, stock]) => (
              <Shelf key={tier} tier={tier} offers={stock} />
            ))}
          </ul>
        )}
      </Box>

      <Box
        title="What Is Coming"
        more={coming ? `${whole.format(coming.total)} ahead` : null}
        lede="From tomorrow onwards — today's is the shelf above. Search and today comes back, because a weapon that is on right now is the answer."
      >
        <form className="market-filters" onSubmit={(event) => event.preventDefault()}>
          <label className="market-filter market-filter--search">
            <span>Search</span>
            <input
              className="field__input"
              type="search"
              value={wanted}
              placeholder="a weapon, or what a modifier does"
              maxLength={64}
              onChange={(event) => {
                setWanted(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="market-filter">
            <span>Rarity</span>
            <select
              value={rarity}
              onChange={(event) => {
                setRarity(event.target.value);
                setPage(0);
              }}
            >
              <option value="">all rarities</option>
              {(coming?.facets?.rarities ?? []).map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.name ?? tierOf(entry.value)} ({entry.count})
                </option>
              ))}
            </select>
          </label>
        </form>

        {coming === null ? (
          <p className="table__empty">Loading…</p>
        ) : !results.length ? (
          <p className="table__empty">
            Nothing coming matches that. The schedule runs to{" "}
            {shop?.last_day ? dayLabel(shop.last_day) : "the end of the tables"}.
          </p>
        ) : (
          <>
            <ul className="comings">
              {results.map((offer) => (
                <Coming key={offer.offer_id} offer={offer} onDay={openDay} />
              ))}
            </ul>
            {pages > 1 ? (
              <div className="market-pager">
                <Button disabled={page === 0} onClick={() => setPage((at) => at - 1)}>
                  Previous
                </Button>
                <span>
                  Page {page + 1} of {pages}
                </span>
                <Button disabled={page + 1 >= pages} onClick={() => setPage((at) => at + 1)}>
                  Next
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Box>

      <Box title="About The Shop">
        <p style={{ marginTop: 0 }}>
          Twenty-two weapons are on sale at a time and they change at nine in the
          morning, UTC. The schedule is the game's own — this page reads it out
          of the same tables the client does, so what is listed here is what will
          be on the shelf.
        </p>
        <p style={{ marginBottom: 0 }}>
          Buying happens in the game. Nothing here spends your gold, and the
          prices are the same for everybody: unlike the market next door, the
          shop is not negotiating.
        </p>
      </Box>
    </Page>
  );
};
