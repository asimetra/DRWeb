import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Notice, Page, Portrait, Stat } from "../components/Chrome.jsx";
import { since, tierOf } from "../market-view.js";

const whole = new Intl.NumberFormat("en-GB");

/**
 * The stats worth putting on a page, and what to call them.
 *
 * Not all of them. The game computes eleven, and a wall of eleven numbers is a
 * thing nobody reads — these are the six somebody actually compares two heroes
 * by, in the order an ARPG has always listed them.
 */
const SHOWN = [
  ["MELEE_ATK", "Melee attack"],
  ["SHOOT_ATK", "Ranged attack"],
  ["MAGIC_ATK", "Magic attack"],
  ["MELEE_DEF", "Melee defence"],
  ["SHOOT_DEF", "Ranged defence"],
  ["MAGIC_DEF", "Magic defence"],
];

/**
 * One hero, as far as its owner has taken it.
 *
 * Every number here is the game server's — the level from the Leveling table,
 * the stats from the same vector the dungeon uses, and the training build the
 * four slots carry with the names the client's own locale gives them. Working
 * any of it out again on this side would be a second opinion to keep in step.
 */
const Hero = ({ hero }) => (
  <div className="hero">
    <div className="hero__head">
      {/* Not the `--me` plate. That one means "this is you, among other
          people"; here every hero is the same person's and the distinction
          being drawn is which is being played — which the line beside it
          already says, and a bigger plate on one card only breaks the row. */}
      <Portrait hero={hero} />
      <span>
        <span className="hero__name">
          {hero.name}
          {hero.active ? <span className="hero__active"> · playing</span> : null}
        </span>
        <span className="hero__level">
          Level {hero.level} · {whole.format(hero.experience)} experience
        </span>
      </span>
    </div>

    <dl className="hero__stats">
      <dt>Health</dt>
      <dd>{whole.format(hero.health ?? 0)}</dd>
      <dt>Mana</dt>
      <dd>{whole.format(hero.mana ?? 0)}</dd>
      {SHOWN.map(([key, label]) =>
        hero.stats?.[key] ? (
          <span key={key} style={{ display: "contents" }}>
            <dt>{label}</dt>
            <dd>{whole.format(Math.round(hero.stats[key]))}</dd>
          </span>
        ) : null
      )}
    </dl>

    {hero.spent?.slots?.length ? (
      <div className="hero__training">
        <p className="hero__training-label">
          Training
          <span className="table__quiet">
            {" "}
            · {whole.format(hero.spent.placed ?? 0)} of {whole.format(hero.spent.earned ?? 0)} points
            {hero.spent.cap ? ` · ${hero.spent.cap} a slot` : ""}
          </span>
        </p>
        <dl className="hero__stats">
          {hero.spent.slots.map((slot) => (
            <span key={slot.slot} style={{ display: "contents" }}>
              <dt>{slot.name ?? slot.stat ?? `Slot ${slot.slot}`}</dt>
              <dd>{whole.format(slot.points)}</dd>
            </span>
          ))}
        </dl>
      </div>
    ) : null}
  </div>
);

/**
 * Somebody else's page.
 *
 * Reached by name from anywhere their name appears — a board row, a market
 * listing — because the question "who is this" is one somebody asks in the
 * middle of doing something else, and making them search for the answer is how
 * a feature goes unused.
 *
 * The market history is the part that matters most and is the part that looks
 * least like a feature. A market where everybody's record is private is one
 * where handing gold to an alt is invisible; open, the pattern that gives it
 * away — the same pair, the same junk weapon, the same enormous price — is
 * something any player can notice without anybody writing a rule about it.
 */
export const Player = () => {
  const { name } = useParams();
  const [player, setPlayer] = useState(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    let live = true;
    setPlayer(null);
    setProblem("");
    api.profile(name).then(
      (next) => live && setPlayer(next),
      (failure) => {
        if (!live) return;
        setProblem(
          failure instanceof ApiError && failure.status === 404
            ? `Nobody here is called ${name}.`
            : "Could not read that profile."
        );
      }
    );
    return () => {
      live = false;
    };
  }, [name]);

  if (problem) {
    return (
      <Page where="Player">
        <Notice kind="bad">{problem}</Notice>
      </Page>
    );
  }
  if (!player) {
    return (
      <Page where="Player">
        <p className="table__empty">Loading…</p>
      </Page>
    );
  }

  return (
    <Page where={player.name}>
      <div className="board-head">
        <h2>{player.name}</h2>
        {player.title ? (
          <span className={`board-head__where title title--${player.title.tier}`}>
            {player.title.name}
          </span>
        ) : null}
      </div>

      <Box title="Deeds">
        <Stat label="Trophies">{whole.format(player.trophies ?? 0)}</Stat>
        <Stat label="Dungeons finished">{whole.format(player.clears ?? 0)}</Stat>
        <Stat label="Experience earned">{whole.format(player.experience_total ?? 0)}</Stat>
        <Stat label="Heroes">{player.heroes?.length ?? 0}</Stat>
      </Box>

      <Box
        title="Heroes"
        more={player.heroes?.length ? `${player.heroes.length} of 6` : null}
        flush
      >
        {player.heroes?.length ? (
          <div className="heroes">
            {player.heroes.map((hero) => (
              <Hero key={hero.id} hero={hero} />
            ))}
          </div>
        ) : (
          <p className="table__empty">No heroes yet.</p>
        )}
      </Box>

      <Box title="Market History" more={player.sales?.length ? "last 20" : null} flush>
        {!player.sales?.length ? (
          <p className="table__empty">Nothing bought or sold.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">Weapon</th>
                  <th scope="col">With</th>
                  <th className="table__num" scope="col">
                    Price
                  </th>
                  <th scope="col">When</th>
                </tr>
              </thead>
              <tbody>
                {player.sales.map((sale) => {
                  const sold = sale.seller_name === player.name;
                  const other = sold ? sale.buyer_name : sale.seller_name;
                  return (
                    <tr key={`${sale.listing_id}-${sale.at}`}>
                      <td className="table__quiet">{sold ? "sold" : "bought"}</td>
                      <td>
                        <span className={`title title--${tierOf(sale.rarity)}`}>
                          {sale.name ?? `item ${sale.item_id}`}
                        </span>
                        {sale.power ? (
                          <span className="table__quiet"> · power {sale.power}</span>
                        ) : null}
                      </td>
                      <td>
                        {other ? (
                          <Link to={`/player/${encodeURIComponent(other)}`}>{other}</Link>
                        ) : (
                          <span className="table__quiet">—</span>
                        )}
                      </td>
                      <td className="table__num">
                        <span className="gold">{whole.format(sale.price)}</span>
                      </td>
                      <td className="table__when">{since(sale.at) ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </Page>
  );
};
