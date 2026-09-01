import { Box, Quiet, Page } from "../components/Chrome.jsx";
import { Standings } from "./Leaderboard.jsx";

/**
 * The front page is standings and nothing else.
 *
 * It carried an explanation of what the server was and four steps to get
 * playing, which is documentation rather than a front page — and the left
 * column already answers the only question a visitor has on arriving, which is
 * how to get in. What belongs here is what changed since they last looked.
 */
export const Home = () => (
  <Page where="Open Dungeon">
    <div className="board-head">
      <h2>Dungeons Finished</h2>
      <span className="board-head__where">lifetime · every hero</span>
    </div>

    <Box title="Standings" more="top 10" flush>
      <Standings metric="clears" limit={10} />
    </Box>

    <Box title="Most Experience" more="top 10" flush>
      <Standings metric="hero_experience" limit={10} />
    </Box>

    <Box>
      <Quiet to="/leaderboard">All boards, including fastest clears</Quiet>
    </Box>
  </Page>
);
