import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Notice, Page, Portrait } from "../components/Chrome.jsx";

const whole = new Intl.NumberFormat("en-GB");

/** Speedrun values are milliseconds; the other two are counts. */
export const showValue = (metric, value) => {
  if (metric !== "speedrun") return whole.format(value);
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * When a record was set, at the coarseness somebody reading a board cares
 * about. "3 days ago" is the answer; the timestamp is not.
 */
const since = (when) => {
  if (!when) return "—";
  const minutes = Math.round((Date.now() - new Date(when).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return "—";
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.floor(days / 7)} weeks ago`;
};

const HEADING = { speedrun: "Time", clears: "Runs", experience: "Experience" };

/**
 * A board, as the table itself: ruled on all four sides of every cell, header
 * banded in the frame's own colour, rows striped. Six columns will not fold
 * into a phone, so the table scrolls inside its panel rather than taking the
 * page sideways with it.
 */
export const Standings = ({ metric, limit = 20, scope = {}, onCount }) => {
  const [board, setBoard] = useState(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    setBoard(null);
    setProblem("");
    api.leaderboard(metric, { limit, ...scope }).then(
      (next) => {
        setBoard(next);
        onCount?.(next.entries.length);
      },
      (failure) =>
        setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.")
    );
    // The scope object is rebuilt each render; its contents are what matter.
  }, [metric, limit, JSON.stringify(scope)]);

  if (problem) {
    return (
      <div style={{ padding: "0.55rem 0.7rem" }}>
        <Notice kind="bad">{problem}</Notice>
      </div>
    );
  }
  if (!board) return <p className="table__empty">Loading…</p>;
  if (!board.entries.length) {
    return <p className="table__empty">Nobody has finished a run on this board yet.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th className="table__rank" scope="col">
              #
            </th>
            <th scope="col">Adventurer</th>
            <th scope="col">Title</th>
            <th className="table__num" scope="col">
              Trophies
            </th>
            <th className="table__num" scope="col">
              {HEADING[metric] ?? "Value"}
            </th>
            <th scope="col">Set</th>
          </tr>
        </thead>
        <tbody>
          {board.entries.map((entry) => (
            <tr key={entry.account_id}>
              <td className="table__rank">{entry.rank}</td>
              {/*
                Who set it, and what they set it on. The hero is the game
                server's answer, carried on the standing — a time belongs to
                the hero who ran it, whatever that player is playing now.

                No account id anywhere. It is the number the client
                authenticates with, and a name is unique now, so it identifies
                somebody without it. A standing set before the hero was recorded
                shows nothing rather than falling back to the number.
              */}
              <td>
                <span className="who">
                  <Portrait hero={entry.hero} />
                  <span>
                    <span className="name">{entry.name || "unnamed"}</span>
                    {entry.hero ? (
                      <span className="who__hero who__hero--row">{entry.hero.name}</span>
                    ) : null}
                  </span>
                </span>
              </td>
              {/*
                A title is what somebody has beaten, not where they placed: a
                trophy is the first clear of a boss node and there are twelve of
                them, so it wears the tier its count has earned.
              */}
              <td className={entry.title ? `title title--${entry.title.tier}` : "table__quiet"}>
                {entry.title ? entry.title.name : "—"}
              </td>
              <td className="table__num">
                {entry.trophies ?? 0}
                <span className="table__quiet"> / 12</span>
              </td>
              <td className="table__num">{showValue(metric, entry.value)}</td>
              <td className="table__when">{since(entry.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const BOARDS = [
  { metric: "clears", tab: "Dungeons finished", where: "lifetime" },
  { metric: "experience", tab: "Experience", where: "all heroes · lifetime" },
  { metric: "speedrun", tab: "Fastest clear", where: null },
];

/**
 * Three boards behind one heading.
 *
 * They were three panels stacked down the page, which made a reader scroll past
 * two to reach the one they came for. A board is a thing you pick, not a thing
 * you pass.
 */
export const Leaderboard = () => {
  const [params] = useSearchParams();
  const node = Number(params.get("node"));
  const hero = Number(params.get("hero"));
  const party = Number(params.get("party")) || 1;
  const scoped = node > 0 && hero > 0;

  const [metric, setMetric] = useState(scoped ? "speedrun" : "clears");
  const [count, setCount] = useState(null);

  const board = BOARDS.find((one) => one.metric === metric);
  const where =
    metric === "speedrun"
      ? scoped
        ? `node ${node} · hero ${hero} · party of ${party}`
        : "pick a dungeon and a hero"
      : board.where;

  return (
    <Page where="Hall of Deeds">
      <div className="board-head">
        <h2>{board.tab}</h2>
        <span className="board-head__where">{where}</span>
      </div>

      <div className="tabs" role="tablist" aria-label="Boards">
        {BOARDS.map((one) => (
          <button
            key={one.metric}
            className="tab"
            role="tab"
            type="button"
            aria-selected={one.metric === metric}
            onClick={() => {
              setCount(null);
              setMetric(one.metric);
            }}
          >
            {one.tab}
          </button>
        ))}
      </div>

      <Box title="Standings" more={count === null ? null : `top ${count}`} flush>
        {/*
          A fastest-clear board is per map node, hero and party size — there is
          no such thing as the fastest clear of everything. Until the site can
          offer that choice from the game's own tables it is taken from the
          query, which is what a link out of the game would carry.
        */}
        {metric === "speedrun" && !scoped ? (
          <p className="table__empty">
            A fastest-clear board belongs to one dungeon, one hero and one party
            size. Reach it with <code>?node=…&amp;hero=…&amp;party=…</code>.
          </p>
        ) : (
          <Standings
            metric={metric}
            limit={20}
            scope={metric === "speedrun" ? { node, hero, party } : {}}
            onCount={setCount}
          />
        )}
        {count ? (
          <div className="pager">
            <span className="pager__count">
              {count === 1 ? "one standing" : `${count} standings`}
            </span>
          </div>
        ) : null}
      </Box>

      <Box title="About These Boards">
        <p style={{ marginTop: 0 }}>
          A run is recorded when its report screen is generated. Nothing is
          ranked that everybody converges on: kills and total damage are set by
          the floor build, gold is partly the reward roll, and damage taken is
          mostly who else was in the party.
        </p>
        <p style={{ marginBottom: 0 }}>
          Infinite Island is on no board: it has no last floor, so a clear time
          is not something that exists there.
        </p>
      </Box>
    </Page>
  );
};
