#!/usr/bin/env node
/**
 * Makes a signed-in, verified account for testing, without the email.
 *
 *   node tools/link-test-user.js 2@example.com 1000005002
 *   node tools/link-test-user.js 2@example.com 1000005002 --password "..."
 *   node tools/link-test-user.js --list
 *
 * Two people are needed to test a trade and each of them has to be a web user
 * holding a game account, which normally means two mailboxes and two
 * confirmation links. This does what confirming the link would have done:
 * makes the user, marks the address verified, and points it at an account that
 * already exists.
 *
 * It is not part of signing up and does not send anything. Nothing here should
 * ever run against a server real people use — it creates a working login for
 * an address nobody proved they own, which is the one thing the confirmation
 * step exists to prevent.
 */
import { config } from "../src/config.js";
import * as storage from "../src/storage/index.js";
import { hashPassword, MIN_PASSWORD_LENGTH } from "../src/passwords.js";

const argument = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? null : process.argv[at + 1] ?? null;
};

const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));

if (config.storage !== "postgres") {
  console.error(`storage is "${config.storage}" — this writes to a database that outlives it.`);
  process.exit(1);
}

/** Which game accounts nobody has claimed yet, so a caller need not guess. */
if (process.argv.includes("--list")) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  const { rows } = await client.query(`
    SELECT a.id, a.name, a.basic_currency AS gold,
           (SELECT count(*) FROM account_items i WHERE i.account_id = a.id) AS items
      FROM accounts a
     WHERE a.id NOT IN (SELECT account_id FROM web.users WHERE account_id IS NOT NULL)
     ORDER BY a.id
     LIMIT 20`);
  for (const row of rows) {
    console.log(`  ${row.id}  ${String(row.name).padEnd(22)} gold ${row.gold}  items ${row.items}`);
  }
  console.log(`\n${rows.length} unclaimed account(s) shown.`);
  await client.end();
  process.exit(0);
}

const [email, accountId] = positional;
if (!email || !accountId) {
  console.error("Usage: node tools/link-test-user.js <email> <accountId> [--password ...]");
  process.exit(1);
}

const password = argument("password") ?? "trade test password";
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`the password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  process.exit(1);
}

const existing = await storage.findUserByEmail(email);
const user = existing ?? (await storage.createUser({
  email,
  passwordHash: await hashPassword(password),
  wantedName: null,
}));

if (existing) console.log(`${email} already existed as user #${user.id}`);

await storage.markVerified(user.id);
await storage.linkAccount(user.id, Number(accountId));
await storage.close();

console.log(`${email} -> game account ${accountId}, verified`);
if (!existing) console.log(`password: ${password}`);
