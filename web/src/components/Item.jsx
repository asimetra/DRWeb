import { tierOf, typeOf } from "../market-view.js";

/**
 * A weapon, drawn.
 *
 * Two pages ask for one: the market, where somebody is selling it, and the
 * shop, where the game is. The weapon is the same weapon and the question being
 * asked of it is the same question — is this my kind, is it strong enough, can
 * I use it, what does it do — so it is drawn in one place. What differs between
 * the two is who is asking for money and how much, and that stays on the pages.
 *
 * Every word here is the game server's answer. This side holds no game data to
 * turn 70211 into "Chargey" and is not meant to, which is the arrangement the
 * repository pair is built on; see the server's `describeListings`, which
 * answers for a listing and for a shop offer both.
 */

/**
 * The icons a deployment exported for itself with tools/export-icons.js: the
 * weapons, and the modifiers rolled onto them.
 *
 * Served by this site from web/public/, not fetched from the game server. They
 * are the game's art so they are not in the repository — but they are a web
 * page's decoration, and asking a game server for it only made the pictures
 * break whenever that server did.
 *
 * Not imported the way the hero portraits are: those are six files that ship
 * with the build, these are two hundred and sixty that may not be there at all.
 *
 * One directory for both kinds, keyed by the name the game's own tables give
 * the icon, which is the name the game server sends with the weapon.
 */
const ICONS = "/icons/";

export const whole = new Intl.NumberFormat("en-GB");

/**
 * The weapon's own icon when the deployment has one, its initials when it has
 * not. Nothing ships an icon — see tools/export-icons.js — so the frame has to
 * stand on its own either way, and the initials stay underneath as what shows
 * when it cannot be loaded rather than as a placeholder that gets replaced.
 *
 * `small` is the row-sized one: the same mark, drawn at the scale a line of
 * text can carry.
 */
export const WeaponMark = ({ listing, small }) => {
  const icon = listing.icon ? `${ICONS}${listing.icon}.png` : null;
  const type = typeOf(listing.mastertype);
  return (
    <span
      className={[
        "sigil__mark",
        icon ? "sigil__mark--art" : "",
        small ? "sigil__mark--small" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
      style={icon ? { backgroundImage: `url(${icon})` } : undefined}
    >
      {icon ? "" : (type || "?").slice(0, 2).toUpperCase()}
    </span>
  );
};

/**
 * The picture, its kind and its rarity, in the box a shop or a trade site puts
 * an item's picture in.
 *
 * The picture is the weapon's own icon when the deployment has exported one,
 * and its type and rarity in words when it has not — neither is a placeholder
 * for the other. Nothing ships an icon: the art belongs to the game, so a
 * deployment reads it out of a copy of the game with tools/export-icons.js. A
 * site that never runs that still has a frame worth looking at.
 *
 * The frame wears the rarity either way, which is the same ladder the rank
 * colours and the title tiers use.
 */
export const Sigil = ({ listing }) => {
  const tier = tierOf(listing.rarity);
  const type = typeOf(listing.mastertype);
  return (
    <div className={`sigil sigil--${tier}`}>
      <WeaponMark listing={listing} />
      <span className="sigil__type">{type || "weapon"}</span>
      {/* Not `title--${tier}`. A saturated word in a small box reads as an
          indicator lamp rather than a rarity — the frame around it already
          carries the colour, and the ladder's saturation is spent on titles
          and item names, which is where it means something. */}
      <span className="sigil__tier">{tier}</span>
    </div>
  );
};

/**
 * One line of what was rolled onto a weapon, with the game's own picture for it
 * when the deployment has exported one.
 *
 * The picture stands beside the words rather than in place of them, and that is
 * not politeness: twenty-two icons cover a hundred and twenty modifiers, so the
 * icon says *what* — this one burns, this one crits — and only the sentence
 * says how much. Nothing distinguishes Sturdy from Hearty but the number in the
 * line. Hidden from a screen reader for the same reason: it repeats the
 * sentence next to it, less exactly.
 */
export const Rolled = ({ modifier, legendary = false }) => {
  const icon = modifier.icon ? `${ICONS}${modifier.icon}.png` : null;
  return (
    <div
      className={`item__mod${legendary ? " item__mod--legendary" : ""}${
        icon ? " item__mod--art" : ""
      }`}
    >
      {icon ? (
        <span
          className="item__mod-mark"
          aria-hidden="true"
          style={{ backgroundImage: `url(${icon})` }}
        />
      ) : null}
      <span>{modifier.description ?? modifier.name}</span>
    </div>
  );
};

/**
 * The whole weapon, read downwards: what it is, what it is worth swinging, and
 * what has been rolled onto it.
 *
 * Stacked rather than run together on one line because that is how it is read
 * — nobody compares two weapons by scanning a sentence — and the order is the
 * order somebody decides in.
 */
export const Detail = ({ listing }) => {
  const modifiers = listing.modifiers ?? [];
  const weapon = listing.weapon;
  return (
    <div className="item">
      <div className={`item__name title--${tierOf(listing.rarity)}`}>
        {listing.name ?? `item ${listing.item_id}`}
      </div>
      {listing.mastertype ? (
        <div className="item__type">
          {typeOf(listing.mastertype)}
          {weapon?.classType ? ` · ${weapon.classType.toLowerCase()}` : ""}
        </div>
      ) : null}
      {listing.usable_by?.length ? (
        <div className="item__fits">
          For {listing.usable_by.map((hero) => hero.name).join(", ")}
        </div>
      ) : null}

      <dl className="item__stats">
        {listing.power ? (
          <>
            <dt>Power</dt>
            <dd>{whole.format(listing.power)}</dd>
          </>
        ) : null}
        {weapon?.speed ? (
          <>
            <dt>Speed</dt>
            <dd>{weapon.speed.toLowerCase()}</dd>
          </>
        ) : null}
        {listing.requiredlevel ? (
          <>
            <dt>Level</dt>
            <dd>{listing.requiredlevel}</dd>
          </>
        ) : null}
        {listing.vendor_value ? (
          <>
            <dt>Shop value</dt>
            <dd>{whole.format(listing.vendor_value)}</dd>
          </>
        ) : null}
      </dl>

      {/* Its two attacks, which are the weapon rather than the roll: every
          Hand Axe has these and no two weapon types share them. */}
      {weapon?.tap?.title || weapon?.hold?.title ? (
        <div className="item__attacks">
          {weapon.tap?.title ? (
            <div className="item__attack">
              <span className="item__attack-name">{weapon.tap.title}</span>
              {weapon.tap.description ? <p>{weapon.tap.description}</p> : null}
            </div>
          ) : null}
          {weapon.hold?.title ? (
            <div className="item__attack">
              <span className="item__attack-name">{weapon.hold.title}</span>
              {weapon.hold.manaCost ? (
                <span className="item__mana"> · {weapon.hold.manaCost} mana</span>
              ) : null}
              {weapon.hold.description ? <p>{weapon.hold.description}</p> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {modifiers.length || listing.legendary ? (
        <div className="item__mods">
          {modifiers.map((modifier) => (
            <Rolled key={modifier.id} modifier={modifier} />
          ))}
          {/* Apart, the way the game keeps it apart: only the top rarity
              carries a third, and it is the line that weapon is bought for. */}
          {listing.legendary ? <Rolled modifier={listing.legendary} legendary /> : null}
        </div>
      ) : null}
    </div>
  );
};

/** Gold, spelled the way every number on the site is spelled. */
export const Gold = ({ children }) => (
  <span className="gold">{whole.format(Number(children ?? 0))}</span>
);
