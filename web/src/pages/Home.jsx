import { useEffect, useState } from "react";
import { api } from "../api.js";
import { Box, Footnote, Quiet, TopBar } from "../components/Chrome.jsx";
import { Standings } from "./Leaderboard.jsx";
import { useViewer } from "../viewer.jsx";

/**
 * The page somebody lands on, which until now was a redirect to a login form.
 *
 * A server people are being invited to play on has to be able to say what it
 * is and how to reach it before it asks anybody for an address and a password.
 * Nothing here needs an account, and nothing here starts a session.
 */
export const Home = () => {
  const { viewer } = useViewer();
  const [server, setServer] = useState(null);

  useEffect(() => {
    api.server().then(setServer, () => undefined);
  }, []);

  return (
    <>
      <TopBar />

      <Box title="Open Dungeon">
        <p>
          An independent server for a dungeon-crawler client. It is not run by,
          endorsed by, or affiliated with the people who made the game.
        </p>
        <p>
          You supply the client yourself, from a copy you are lawfully entitled
          to use. This server holds accounts, runs the dungeons and keeps score;
          it ships no game files of its own.
        </p>
      </Box>

      <Box title="Getting Started">
        <ol className="steps">
          <li>
            Create an account with an email address you can read.
          </li>
          <li>
            Open the link that arrives. Your game account is created at that
            point, and you are shown an account id and a validation token.
          </li>
          <li>
            Put both into your client's configuration file, as
            <code> AccountId </code> and <code>API_ValidationToken</code>.
          </li>
          <li>
            Point the client at this server and start it.
            {server ? <code className="address">{server.gameAddress}</code> : null}
          </li>
        </ol>
        <Footnote>
          {viewer ? (
            <Quiet to="/account">Your account</Quiet>
          ) : (
            <>
              <Quiet to="/register">Create an account</Quiet>
              {" · "}
              <Quiet to="/login">Log in</Quiet>
            </>
          )}
        </Footnote>
      </Box>

      <Box title="Dungeons Cleared" lede="The five who have finished the most.">
        <Standings metric="clears" limit={5} />
        <Footnote>
          <Quiet to="/leaderboard">All leaderboards</Quiet>
        </Footnote>
      </Box>

      <Box title="Playing Together">
        <p>
          Dungeons hold four. You can join a friend from the map screen, or take
          whoever the matchmaker finds.
        </p>
        <p>
          Weapons and gold can be traded on this site, between any two players
          who are not in a dungeon at the time. Both sides have to agree, and
          changing either offer clears both agreements.
        </p>
        <Footnote>
          {viewer ? <Quiet to="/trade">Open a trade</Quiet> : "Log in to trade."}
        </Footnote>
      </Box>
    </>
  );
};
