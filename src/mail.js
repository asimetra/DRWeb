import { config } from "./config.js";

/**
 * Sending the one mail this application sends.
 *
 * A seam rather than a direct call to a mail library, for two reasons. The
 * tests need to read what would have been sent without a server standing
 * behind them, and a deployment without SMTP configured needs to do something
 * better than throw — writing the link to the log is what makes the whole flow
 * exercisable on a laptop.
 */

const verificationMessage = (email, link) => ({
  to: email,
  subject: "Confirm your address",
  text: [
    "Somebody signed up with this address.",
    "",
    "Open this to finish, and your game account will be created:",
    link,
    "",
    `The link stops working in ${Math.round(config.linkTtlMs / 3_600_000)} hours.`,
    "If this was not you, ignore this message. Nothing has been created yet.",
  ].join("\n"),
});

const resetMessage = (email, link) => ({
  to: email,
  subject: "Reset your password",
  text: [
    "Somebody asked to reset the password for this address.",
    "",
    "Open this to choose a new one:",
    link,
    "",
    `The link stops working in ${Math.round(config.linkTtlMs / 3_600_000)} hours.`,
    "",
    "If this was not you, ignore this message — your password has not changed.",
    "Resetting also signs the game client out, so nobody can keep playing on a",
    "token taken while they had access.",
  ].join("\n"),
});

/**
 * The link points at the front end, not at the API.
 *
 * A mail client or a scanner fetches the links in a message to preview them,
 * and a GET that consumes the token would be spent before its owner ever
 * clicked. So the link opens a page, and the page posts the token.
 */
export const verificationLink = (token) =>
  `${config.publicUrl}/verify?token=${encodeURIComponent(token)}`;

export const resetLink = (token) =>
  `${config.publicUrl}/reset?token=${encodeURIComponent(token)}`;

/** Writes what it would have sent. The default, and never the right one in production. */
const notSent = (subject, email, link) =>
  console.warn(
    `mail: no ODW_SMTP_URL configured, not sending "${subject}" to ${email}\n      ${link}`
  );

export const logMailer = {
  async sendVerification(email, token) {
    notSent(verificationMessage(email, "").subject, email, verificationLink(token));
  },
  async sendPasswordReset(email, token) {
    notSent(resetMessage(email, "").subject, email, resetLink(token));
  },
};

export const createMailer = async () => {
  if (!config.smtpUrl) return logMailer;

  const { createTransport } = await import("nodemailer");
  const transport = createTransport(config.smtpUrl);

  return {
    async sendVerification(email, token) {
      await transport.sendMail({
        from: config.mailFrom,
        ...verificationMessage(email, verificationLink(token)),
      });
    },
    async sendPasswordReset(email, token) {
      await transport.sendMail({
        from: config.mailFrom,
        ...resetMessage(email, resetLink(token)),
      });
    },
  };
};
