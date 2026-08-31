import { createHash, randomBytes } from "node:crypto";

/**
 * The single-use links this application mails.
 *
 * 32 random bytes, held as a digest. Guessing is not a threat model at that
 * width, which is why a plain SHA-256 is right where a password needs argon2 —
 * a slow hash exists to defend a small set of likely values, and there is no
 * such set here. Hashing at all is about the table leaking: a stored token is
 * a working link for somebody who has proved nothing yet.
 */
export const PURPOSE = Object.freeze({
  VERIFY: "verify",
  RESET: "reset",
});

export const mintToken = () => randomBytes(32).toString("base64url");

export const digestOf = (token) => createHash("sha256").update(token).digest("hex");
