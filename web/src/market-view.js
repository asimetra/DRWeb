const TIERS = ["common", "uncommon", "rare", "legendary"];

/** GameMaster rarity ids are 1-based; CSS tier names are not. */
export const tierOf = (rarity) =>
  TIERS[Math.max(0, Math.min(TIERS.length - 1, Number(rarity ?? 1) - 1))] ?? "common";

export const typeOf = (mastertype) =>
  String(mastertype ?? "")
    .replace(/_TYPE$/, "")
    .replace(/_/g, " ")
    .toLowerCase();

/**
 * How long a listing has been up, at the coarseness somebody browsing cares
 * about. The timestamp is not the answer; "3 days ago" is.
 */
export const since = (when) => {
  if (!when) return null;
  const minutes = Math.round((Date.now() - new Date(when).getTime()) / 60_000);
  if (!Number.isFinite(minutes)) return null;
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
};

/**
 * The listing as text, for the clipboard.
 *
 * The one thing a trade site is asked for outside itself: somebody wants to
 * paste what they are looking at into a chat and ask whether it is worth the
 * money. Laid out the way the card reads, because that is the arrangement they
 * are looking at when they press it.
 */
export const asText = (listing) => {
  const lines = [listing.name ?? `item ${listing.item_id}`];
  const type = [typeOf(listing.mastertype), listing.weapon?.classType?.toLowerCase()]
    .filter(Boolean)
    .join(" · ");
  if (type) lines.push(type);
  lines.push("--------");

  if (listing.power) lines.push(`Power: ${listing.power}`);
  if (listing.weapon?.speed) lines.push(`Speed: ${listing.weapon.speed.toLowerCase()}`);
  if (listing.requiredlevel) lines.push(`Requires level ${listing.requiredlevel}`);

  for (const modifier of listing.modifiers ?? []) {
    lines.push(modifier.description ?? modifier.name);
  }
  if (listing.legendary) lines.push(listing.legendary.description ?? listing.legendary.name);

  lines.push("--------");
  lines.push(`Asking ${listing.price} gold`);
  if (listing.seller_name) lines.push(`Seller: ${listing.seller_name}`);
  return lines.join("\n");
};
