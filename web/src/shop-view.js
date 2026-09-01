/**
 * Saying when, for a shop that turns over once a day.
 *
 * A rotation day is named by the date its stock went up and runs from nine that
 * morning to nine the next, in UTC — the game's clock, not the reader's. That
 * matters for the naming: shifting the label into local time would put a day
 * called "Wednesday" on somebody's Tuesday evening screen, and the whole point
 * of the label is to be the same day everybody else is talking about.
 *
 * The clock is passed in rather than read, because a thing that says "today"
 * cannot be tested against a machine's own idea of it.
 */

const WEEKDAY = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** The rotation day a moment falls in — the same arithmetic the game server does. */
export const dayOf = (now) =>
  new Date(new Date(now).getTime() - 9 * 3_600_000).toISOString().slice(0, 10);

/**
 * A day's name, in the two words somebody would actually use for it.
 *
 * "Today" and "tomorrow" beat a date for the two days anybody is looking at,
 * and a date beats them for every other day: nobody counts forward eleven
 * sleeps to work out what "in 11 days" means.
 */
export const dayLabel = (day, now = new Date()) => {
  const today = dayOf(now);
  if (day === today) return "today";
  if (day === dayOf(new Date(new Date(now).getTime() + 86_400_000))) return "tomorrow";
  return WEEKDAY.format(new Date(`${day}T12:00:00Z`)).replace(",", "");
};

const HOUR = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23",
});

/**
 * The hour a day's stock goes up, said in the clock it happens on.
 *
 * Named "UTC" out loud rather than converted, because the whole point of the
 * line is that everybody's shop turns over at the same moment: converted, two
 * players comparing notes would read two different times for one event.
 */
export const opensLabel = (opensAt) =>
  opensAt ? `${HOUR.format(new Date(opensAt))} UTC` : null;

/**
 * How long the stock has left, at the coarseness somebody cares about.
 *
 * Minutes near the end, because the last hour is the one where it matters
 * whether you have time to earn the gold; hours the rest of the day, because
 * "7h 41m" is a false precision on something nobody is waiting for.
 */
export const until = (closesAt, now = new Date()) => {
  if (!closesAt) return null;
  const left = new Date(closesAt).getTime() - new Date(now).getTime();
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "any moment";

  const minutes = Math.floor(left / 60_000);
  if (minutes < 1) return "less than a minute";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};
