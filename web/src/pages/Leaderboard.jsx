import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Footnote, Notice, Quiet, TopBar } from "../components/Chrome.jsx";

/**
 * The boards, readable by anybody.
 *
 * Two of the three are shown. `speedrun` is scoped to a map node, a hero and a
 * party size, and naming those needs the game's own tables, which this
 * application does not have — so it is reachable by URL and has no picker yet.
 */
export const BOARDS = [
  { metric: "experience", title: "Experience", unit: "earned, all heroes" },
  { metric: "clears", title: "Dungeons Cleared", unit: "finished, ever" },
];

const whole = new Intl.NumberFormat("en-GB");

/** Speedrun values are milliseconds; the other two are counts. */
export const showValue = (metric, value) => {
  if (metric !== "speedrun") return whole.format(value);
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export const Standings = ({ metric, limit = 20, scope = {} }) => {
  const [board, setBoard] = useState(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    api.leaderboard(metric, { limit, ...scope }).then(setBoard, (failure) =>
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.")
    );
    // The scope object is rebuilt on every render; its contents are what matter.
  }, [metric, limit, JSON.stringify(scope)]);

  if (problem) return <Notice kind="bad">{problem}</Notice>;
  if (!board) return <p className="wait">Loading…</p>;
  if (!board.entries.length) {
    return <p className="wait">Nobody has finished a run on this board yet.</p>;
  }

  return (
    <table className="board">
      <thead>
        <tr>
          <th className="board__rank">#</th>
          <th>Player</th>
          <th className="board__value">
            {metric === "speedrun" ? "Time" : metric === "clears" ? "Clears" : "Experience"}
          </th>
        </tr>
      </thead>
      <tbody>
        {board.entries.map((entry) => (
          <tr key={entry.account_id}>
            <td className="board__rank">{entry.rank}</td>
            <td>
              {entry.name || "unnamed"}{" "}
              <span className="board__who">({entry.account_id})</span>
            </td>
            <td className="board__value">{showValue(metric, entry.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const Leaderboard = () => {
  const [params] = useSearchParams();
  const node = Number(params.get("node"));
  const hero = Number(params.get("hero"));

  return (
    <>
      <TopBar where="Leaderboards" />

      {node > 0 && hero > 0 ? (
        <Box
          title="Fastest Clear"
          lede={`Map node ${node}, hero ${hero}, party of ${params.get("party") || 1}. Successful runs only.`}
        >
          <Standings
            metric="speedrun"
            limit={20}
            scope={{ node, hero, party: Number(params.get("party")) || 1 }}
          />
        </Box>
      ) : null}

      {BOARDS.map((board) => (
        <Box key={board.metric} title={board.title} lede={board.unit}>
          <Standings metric={board.metric} limit={20} />
        </Box>
      ))}

      <Box title="About These Boards">
        <p>
          A run is recorded when its report screen is generated, and the
          standings are folded in at the same moment. Nothing is ranked that
          everybody converges on: kills and total damage are set by the floor
          build, gold is partly the reward roll, and damage taken is mostly who
          else was in the party.
        </p>
        <p>
          Infinite Island appears on no board. It has no last floor, so a clear
          time is not something that exists there.
        </p>
        <Footnote>
          Fastest-clear boards are per map node, hero and party size. Reach one
          with <code>?node=…&amp;hero=…&amp;party=…</code>.
        </Footnote>
      </Box>
    </>
  );
};
