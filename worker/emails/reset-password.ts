import type { Email } from "../email";

// Email HTML has to survive Gmail, Outlook and phone mail apps: tables for layout, inline styles only,
// no external images or fonts, and a light design that still reads when a client forces dark mode.

const BRAND = "#0ca678"; // the app's teal (Mantine teal.7)
const TEXT = "#1f2933";
const MUTED = "#6b7280";
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function resetPasswordEmail({
  name,
  link,
  minutes,
}: {
  name: string | null;
  link: string;
  minutes: number;
}): Omit<Email, "to"> {
  const greeting = name ? `Hi ${name},` : "Hi,";
  const safeLink = escapeHtml(link);

  const text = [
    greeting,
    "",
    "We got a request to reset the password for your Worthia account.",
    "",
    "Set a new password:",
    link,
    "",
    `This link works once and expires in ${minutes} minutes. Changing your password signs you out on every other device.`,
    "",
    "Didn't ask for this? You can ignore this email; your password stays the same.",
    "",
    "— Worthia",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>Reset your Worthia password</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">Use this link within ${minutes} minutes to choose a new password.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;">
        <tr>
          <td style="padding:28px 32px 0 32px;font-family:${FONT};">
            <span style="display:inline-block;width:28px;height:28px;line-height:28px;border-radius:7px;background:${BRAND};color:#ffffff;font-weight:700;font-size:16px;text-align:center;vertical-align:middle;">W</span>
            <span style="font-size:18px;font-weight:700;color:${TEXT};vertical-align:middle;padding-left:8px;">Worthia</span>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 0 32px;font-family:${FONT};color:${TEXT};">
            <h1 style="margin:0 0 16px 0;font-size:22px;line-height:1.3;font-weight:700;">Reset your password</h1>
            <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p>
            <p style="margin:0;font-size:15px;line-height:1.6;">We got a request to reset the password for your Worthia account. Click the button below to choose a new one.</p>
          </td>
        </tr>
        <tr>
          <td align="left" style="padding:24px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" bgcolor="${BRAND}" style="border-radius:8px;">
                  <a href="${safeLink}" target="_blank" style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">Set a new password</a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px;font-family:${FONT};color:${TEXT};">
            <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;">This link works <strong>once</strong> and expires in <strong>${minutes} minutes</strong>. Changing your password signs you out on every other device.</p>
            <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED};">Button not working? Copy this link into your browser:<br>
              <a href="${safeLink}" target="_blank" style="color:${BRAND};word-break:break-all;">${safeLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 28px 32px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td style="border-top:1px solid #e5e7eb;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
            <p style="margin:16px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${MUTED};">Didn't ask for this? You can safely ignore this email; your password stays the same and no one can change it without this link.</p>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0 0;font-family:${FONT};font-size:12px;line-height:1.5;color:#9ca3af;">You're receiving this because a password reset was requested for your Worthia account.</p>
    </td>
  </tr>
</table>
</body>
</html>`;

  return { subject: "Reset your Worthia password", text, html };
}
