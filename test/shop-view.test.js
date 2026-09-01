import assert from "node:assert/strict";
import test from "node:test";

import { dayLabel, dayOf, opensLabel, until } from "../web/src/shop-view.js";

/**
 * The shop's clock is the game's, not the reader's.
 *
 * Everything here is fixed against a moment passed in rather than against the
 * machine's own, which is the only way a thing that says "today" can be tested
 * at all — and the reason the helpers take one.
 */

test("the rotation day turns over at nine, the way the game's tables do", () => {
  assert.equal(dayOf("2026-09-02T08:59:59Z"), "2026-09-01");
  assert.equal(dayOf("2026-09-02T09:00:00Z"), "2026-09-02");
});

test("the two days anybody is looking at are named, the rest are dated", () => {
  const now = "2026-09-02T12:00:00Z";
  assert.equal(dayLabel("2026-09-02", now), "today");
  assert.equal(dayLabel("2026-09-03", now), "tomorrow");
  assert.equal(dayLabel("2026-09-13", now), "Sun 13 Sept");
});

/**
 * A day is named in UTC on purpose. Shifted into the reader's time zone, a day
 * the whole server calls Wednesday would appear on somebody's Tuesday evening
 * screen, and the label's only job is to be the one everybody else is using.
 */
test("a day keeps its name wherever it is read", () => {
  const beforeMidnightInAuckland = "2026-09-02T11:30:00Z";
  assert.equal(dayLabel("2026-09-04", beforeMidnightInAuckland), "Fri 4 Sept");
});

test("what is left is minutes at the end and hours before it", () => {
  const now = "2026-09-02T12:00:00Z";
  assert.equal(until("2026-09-02T16:12:00Z", now), "4h 12m");
  assert.equal(until("2026-09-02T12:41:00Z", now), "41m");
  assert.equal(until("2026-09-02T12:00:30Z", now), "less than a minute");
});

test("stock that has run out says so rather than counting backwards", () => {
  assert.equal(until("2026-09-02T09:00:00Z", "2026-09-02T12:00:00Z"), "any moment");
  assert.equal(until(null, "2026-09-02T12:00:00Z"), null);
});

/**
 * Said in UTC and named as UTC, rather than converted. Two players comparing
 * notes about when the shop turns over have to be reading one time, and the
 * moment is the same for both of them wherever they are.
 */
test("the hour the stock goes up is said in the clock it happens on", () => {
  assert.equal(opensLabel("2026-09-02T09:00:00.000Z"), "09:00 UTC");
  assert.equal(opensLabel(null), null);
});
