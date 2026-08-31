import { config } from "../config.js";

/**
 * Whichever backend the configuration named, behind one shape.
 *
 * Chosen once, at import, rather than per call: the two are interchangeable
 * and a process that changed its mind halfway would be a process with users in
 * two places.
 */
const backend =
  config.storage === "memory"
    ? await import("./memory.js")
    : await import("./postgres.js");

export const {
  createUser,
  findUserByEmail,
  findUserById,
  linkAccount,
  deleteUser,
  touchLogin,
  markVerified,
  createVerification,
  findVerification,
  consumeVerification,
  deleteUserVerifications,
  setSession,
  getSession,
  destroySession,
  destroyUserSessions,
  ping,
  close,
} = backend;

export { EmailTaken } from "./errors.js";
