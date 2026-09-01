import berserker from "./assets/heroes/berserker.png";
import ranger from "./assets/heroes/ranger.png";
import sorcerer from "./assets/heroes/sorcerer.png";
import battleChef from "./assets/heroes/battle-chef.png";
import vampireHunter from "./assets/heroes/vampire-hunter.png";
import ghostSamurai from "./assets/heroes/ghost-samurai.png";

/**
 * The site's own hero portraits.
 *
 * Imported rather than pointed at. Files under `public/` are copied to the
 * server verbatim and keep their names forever, so a browser that has cached
 * one keeps the old picture after it is replaced; imported ones get a content
 * hash in the filename, which makes replacing a portrait a thing that reaches
 * people. They are also then part of the build rather than a directory the
 * build hopes is there.
 *
 * Keyed by the GameMaster's hero id, which is what every payload that names a
 * hero already carries — the boards, the profile, the character rail. The
 * server still sends an `icon` alongside it, naming the client's own asset;
 * nothing here reads it any more.
 *
 * Six is the whole roster and the game has no way to add a seventh, so a map is
 * the honest shape: a missing key is a hero that does not exist rather than a
 * picture somebody forgot.
 */
export const HERO_PORTRAITS = {
  101: berserker,
  102: ranger,
  103: sorcerer,
  104: battleChef,
  105: vampireHunter,
  106: ghostSamurai,
};

export const portraitFor = (hero) => HERO_PORTRAITS[Number(hero?.id)] ?? null;
