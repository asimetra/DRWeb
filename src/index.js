import { buildApp } from "./app.js";
import { config, configProblems } from "./config.js";
import * as storage from "./storage/index.js";

/**
 * Everything that can be wrong with a deployment is checked here, before the
 * port is bound, so that it is reported by the command that started the server
 * rather than by the first person who tries to sign up.
 */
const problems = configProblems();
if (problems.length) {
  for (const problem of problems) console.error(`config: ${problem}`);
  console.error(
    "\nSet them and start again. For a quick look without a database, " +
      "ODW_STORAGE=memory keeps everything in the process and loses it on restart."
  );
  process.exit(1);
}

try {
  await storage.ping();
} catch (problem) {
  console.error(`storage: ${problem.message}`);
  console.error(
    "The web schema lives in the game's database — apply db/schema.sql once, " +
      "or set ODW_STORAGE=memory to run without one."
  );
  process.exit(1);
}

const app = await buildApp({ logger: true });
await app.listen({ host: config.host, port: config.port });
app.log.info(`storage: ${config.storage}`);
app.log.info(`game server internal API: ${config.gameInternalUrl}`);

const stop = async (signal) => {
  app.log.info(`${signal}: closing`);
  await app.close();
  await storage.close();
  process.exit(0);
};
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
