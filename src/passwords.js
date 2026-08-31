import { hash, verify, Algorithm } from "@node-rs/argon2";

/**
 * Argon2id, at the parameters OWASP gives as a floor: 19 MiB of memory, two
 * passes, one lane. Memory is what makes a stolen table expensive to attack in
 * parallel, so it is the number to raise if this ever needs to be stronger.
 *
 * The salt is not a parameter here because argon2 generates one per hash and
 * carries it in the encoded string, along with the parameters themselves —
 * which is what lets these be raised later without invalidating a single
 * existing password.
 */
const PARAMETERS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Long enough to be worth having, short enough that nobody can hand this
 * process a megabyte to hash. Argon2 has no silent truncation of its own — the
 * 72-byte limit people remember is bcrypt's — so the ceiling is about work,
 * not correctness.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 1024;

export const passwordProblem = (password) => {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  }
  return null;
};

export const hashPassword = (password) => hash(password, PARAMETERS);

/**
 * A wrong password and a hash this build cannot read both mean "not them", and
 * the second throws. Catching it here keeps a corrupt row from answering 500,
 * which would tell an attacker that the address exists.
 */
export const checkPassword = async (password, encoded) => {
  try {
    return await verify(encoded, password, PARAMETERS);
  } catch {
    return false;
  }
};
