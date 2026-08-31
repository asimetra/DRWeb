import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api.js";
import { Box, Notice, Page } from "../components/Chrome.jsx";

const whole = new Intl.NumberFormat("en-GB");

/** Speedrun values are milliseconds; the other two are counts. */
export const showValue = (metric, value) => {
  if (metric !== "speedrun") return whole.format(value);
  const seconds = Math.round(value / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const HEADING = { speedrun: "Time", clears: "Clears", experience: "Experience" };

/**
 * A board, as the table itself: flush to its frame, header in the frame's own
 * colour, rows striped. It is the shape every list on this site takes.
 */
export const Standings = ({ metric, limit = 20, scope = {} }) => {
  const [board, setBoard] = useState(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    api.leaderboard(metric, { limit, ...scope }).then(setBoard, (failure) =>
      setProblem(failure instanceof ApiError ? failure.message : "Something went wrong.")
    );
    // The scope object is rebuilt each render; its contents are what matter.
  }, [metric, limit, JSON.stringify(scope)]);

  if (problem) {
    return (
      <div style={{ padding: "9px 10px" }}>
        <Notice kind="bad">{problem}</Notice>
      </div>
    );
  }
  if (!board) return <p className="table__empty">Loading…</p>;
  if (!board.entries.length) {
    return <p className="table__empty">Nobody has finished a run on this board yet.</p>;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th className="table__rank">#</th>
          <th>Player</th>
          <th>Title</th>
          <th className="table__num">Trophies</th>
          <th className="table__num">{HEADING[metric] ?? "Value"}</th>
        </tr>
      </thead>
      <tbody>
        {board.entries.map((entry) => (
          <tr key={entry.account_id}>
            <td className="table__rank">{entry.rank}</td>
            <td>
              {entry.name || "unnamed"}{" "}
              <span className="table__quiet">{entry.account_id}</span>
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
    <Page where="Leaderboards">
      {node > 0 && hero > 0 ? (
        <Box
          title={`Fastest Clear — node ${node}, hero ${hero}, party of ${params.get("party") || 1}`}
          flush
        >
          <Standings
            metric="speedrun"
            limit={20}
            scope={{ node, hero, party: Number(params.get("party")) || 1 }}
          />
        </Box>
      ) : null}

      <Box title="Experience" flush>
        <Standings metric="experience" limit={20} />
      </Box>

      <Box title="Dungeons Cleared" flush>
        <Standings metric="clears" limit={20} />
      </Box>

      <Box title="About These Boards">
        <p style={{ marginTop: 0 }}>
          A run is recorded when its report screen is generated. Nothing is
          ranked that everybody converges on: kills and total damage are set by
          the floor build, gold is partly the reward roll, and damage taken is
          mostly who else was in the party.
        </p>
        <p style={{ marginBottom: 0 }}>
          Fastest-clear boards are per map node, hero and party size, and are
          reached with <code>?node=…&amp;hero=…&amp;party=…</code>. Infinite
          Island is on no board: it has no last floor, so a clear time is not
          something that exists there.
        </p>
      </Box>
    </Page>
  );
};
