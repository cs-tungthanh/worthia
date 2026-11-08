// Outgoing email through whichever provider has a key set:
// - Brevo (https://brevo.com), free 300/day, can send from a single verified address such as a Gmail one.
// - Resend (https://resend.com), needs a domain you own and have verified there.
// EMAIL_FROM is "Name <address>", e.g. "Wealth <you@gmail.com>" for Brevo or "Wealth <noreply@yourdomain.com>" for Resend.

export type EmailEnv = { BREVO_API_KEY?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string };
export type Email = { to: string; subject: string; text: string; html: string };

// "Wealth <a@b.com>" → { name: "Wealth", email: "a@b.com" }; a bare address has no name.
export function parseFrom(from: string) {
  const m = from.trim().match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  return m
    ? { name: m[1].replace(/^"|"$/g, "").trim() || undefined, email: m[2] }
    : { name: undefined, email: from.trim() };
}

export function emailConfigured(env: EmailEnv) {
  return Boolean(env.EMAIL_FROM && (env.BREVO_API_KEY || env.RESEND_API_KEY));
}

// Throws if the provider refuses the message, so the caller can log why.
export async function sendEmail(env: EmailEnv, msg: Email) {
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");

  if (env.BREVO_API_KEY) {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        sender: parseFrom(env.EMAIL_FROM),
        to: [{ email: msg.to }],
        subject: msg.subject,
        textContent: msg.text,
        htmlContent: msg.html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status}: ${await res.text()}`);
    return;
  }

  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return;
  }

  throw new Error("No email provider key is set (BREVO_API_KEY or RESEND_API_KEY)");
}
