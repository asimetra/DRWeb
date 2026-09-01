import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../src/config.js";
import { GameServerError, readStatus } from "../src/game.js";

test("a hung game-server request is aborted at the configured deadline", async () => {
  const originalFetch = globalThis.fetch;
  const originalTimeout = config.gameRequestTimeoutMs;
  const keepProcessAlive = setTimeout(() => {}, 1000);
  config.gameRequestTimeoutMs = 20;
  globalThis.fetch = async (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    });
  try {
    await assert.rejects(
      readStatus(),
      (problem) => problem instanceof GameServerError && problem.status === 504
    );
  } finally {
    clearTimeout(keepProcessAlive);
    globalThis.fetch = originalFetch;
    config.gameRequestTimeoutMs = originalTimeout;
  }
});

test("network topology details are not returned as the public error message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("connect ECONNREFUSED 10.42.0.7:8081");
  };
  try {
    await assert.rejects(readStatus(), (problem) => {
      assert.equal(problem.status, 503);
      assert.equal(problem.message, "game server unavailable");
      assert.ok(!problem.message.includes("10.42.0.7"));
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
