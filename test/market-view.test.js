import assert from "node:assert/strict";
import test from "node:test";

import { tierOf, typeOf } from "../web/src/market-view.js";

test("GameMaster's one-based rarity ids map to the right visual tier", () => {
  assert.equal(tierOf(1), "common");
  assert.equal(tierOf(2), "uncommon");
  assert.equal(tierOf(3), "rare");
  assert.equal(tierOf(4), "legendary");
});

test("weapon master types become readable filter labels", () => {
  assert.equal(typeOf("LIGHTNING_STAFF_TYPE"), "lightning staff");
});
