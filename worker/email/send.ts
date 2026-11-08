import { EMAIL_PROVIDERS, type EmailSettings } from "../config";

// Outgoing email through whichever provider has a key set (picked in ../config.ts, emailSettings):
// - Brevo (https://brevo.com), free 300/day, can send from a single verified address such as a Gmail one.
// - Resend (https://resend.com), needs a domain you own and have verified there.
// EMAIL_FROM is "Name <address>", e.g. "Worthia <you@gmail.com>" for Brevo or "Worthia <noreply@yourdomain.com>" for Resend.

export type Email = { to: string; subject: string; text: string; html: string };

// "Worthia <a@b.com>" → { name: "Worthia", email: "a@b.com" }; a bare address has no name.
export function parseFrom(from: string) {
  const m = from.trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  return m
    ? { name: m[1].replace(/^"|"$/g, "").trim() || undefined, email: m[2] }
    : { name: undefined, email: from.trim() };
}

// Throws if the provider refuses the message, so the caller can log why.
export async function sendEmail(settings: EmailSettings, msg: Email) {
  if (settings.provider === "brevo") {
    const res = await fetch(EMAIL_PROVIDERS.brevo, {
      method: "POST",
      headers: { "api-key": settings.apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: parseFrom(settings.from),
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
        htmlContent: msg.html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return;
  }

  const res = await fetch(EMAIL_PROVIDERS.resend, {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: settings.from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}
