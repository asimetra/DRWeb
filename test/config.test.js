import assert from "node:assert/strict";
import test from "node:test";

import { configProblems, loadConfig } from "../src/config.js";

test("forwarded client addresses are distrusted unless the operator opts in", () => {
  assert.equal(loadConfig({}).trustProxy, false);
  assert.equal(loadConfig({ ODW_TRUST_PROXY: "1" }).trustProxy, true);
});

test("a remote web bind cannot silently expose an insecure session cookie", () => {
  const base = {
    ODW_HOST: "0.0.0.0",
    ODW_SESSION_SECRET: "s".repeat(48),
    ODW_GAME_INTERNAL_TOKEN: "i".repeat(48),
    ODW_STORAGE: "memory",
  };
  assert.ok(configProblems(loadConfig(base)).some((problem) => /insecure non-loopback web bind/.test(problem)));
  assert.ok(
    !configProblems(loadConfig({ ...base, ODW_ALLOW_INSECURE_REMOTE: "1" }))
      .some((problem) => /insecure non-loopback web bind/.test(problem))
  );
});

test("the internal shared secret has a production-sized minimum", () => {
  const settings = loadConfig({
    ODW_SESSION_SECRET: "s".repeat(48),
    ODW_GAME_INTERNAL_TOKEN: "short",
    ODW_STORAGE: "memory",
  });
  assert.ok(configProblems(settings).some((problem) => /INTERNAL_TOKEN.*32/.test(problem)));
});

test("cleartext internal traffic cannot silently leave loopback", () => {
  const base = {
    ODW_SESSION_SECRET: "s".repeat(48),
    ODW_GAME_INTERNAL_TOKEN: "i".repeat(48),
    ODW_STORAGE: "memory",
    ODW_GAME_INTERNAL_URL: "http://game.internal:8081",
  };
  assert.ok(configProblems(loadConfig(base)).some((problem) => /cleartext.*non-loopback/.test(problem)));
  assert.ok(
    !configProblems(loadConfig({ ...base, ODW_ALLOW_INSECURE_GAME_INTERNAL: "1" }))
      .some((problem) => /cleartext.*non-loopback/.test(problem))
  );
});

test("production refuses insecure cookies, link logging and volatile storage", () => {
  const problems = configProblems(loadConfig({
    NODE_ENV: "production",
    ODW_SESSION_SECRET: "s".repeat(48),
    ODW_GAME_INTERNAL_TOKEN: "i".repeat(48),
    ODW_STORAGE: "memory",
    ODW_PUBLIC_URL: "http://example.test",
    ODW_COOKIE_SECURE: "0",
  }));
  assert.ok(problems.some((problem) => /secure session cookies/.test(problem)));
  assert.ok(problems.some((problem) => /PUBLIC_URL.*HTTPS/.test(problem)));
  assert.ok(problems.some((problem) => /SMTP_URL/.test(problem)));
  assert.ok(problems.some((problem) => /memory.*production/.test(problem)));
});

test("production does not silently use the development database credentials", () => {
  const problems = configProblems(loadConfig({
    NODE_ENV: "production",
    ODW_SESSION_SECRET: "s".repeat(48),
    ODW_GAME_INTERNAL_TOKEN: "i".repeat(48),
    ODW_STORAGE: "postgres",
    ODW_PUBLIC_URL: "https://example.test",
    ODW_COOKIE_SECURE: "1",
    ODW_SMTP_URL: "smtp://mail.example.test",
  }));
  assert.ok(problems.some((problem) => /DATABASE_URL.*production/.test(problem)));
});
