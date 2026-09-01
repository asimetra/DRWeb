import assert from "node:assert/strict";
import test from "node:test";

import { resetLink, verificationLink } from "../src/mail.js";

test("mailed credentials live in the URL fragment, never the logged query string", () => {
  const token = "secret/value+with?punctuation";
  for (const link of [verificationLink(token), resetLink(token)]) {
    const url = new URL(link);
    assert.equal(url.search, "");
    assert.match(url.hash, /^#token=/);
    assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), token);
  }
});
