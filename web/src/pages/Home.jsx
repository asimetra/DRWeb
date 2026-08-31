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
  <Page where="Front page">
    <Box title="Dungeons Cleared" flush>
      <Standings metric="clears" limit={10} />
    </Box>

    <Box title="Experience" flush>
      <Standings metric="experience" limit={10} />
    </Box>

    <Box>
      <Quiet to="/leaderboard">All leaderboards, including fastest clears</Quiet>
    </Box>
  </Page>
);
