/**
 * One address, one account. Raised rather than returned because every caller
 * of `createUser` has to do something different about it, and a null would be
 * indistinguishable from the failures that are nobody's fault.
 */
export class EmailTaken extends Error {
  constructor(email) {
    super(`an account already exists for ${email}`);
    this.name = "EmailTaken";
  }
}
