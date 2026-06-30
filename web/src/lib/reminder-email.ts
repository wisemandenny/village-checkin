// Email content for the unpaid-check-in reminders. Kept separate from the cron
// route so it can be unit-tested and previewed without pulling in server-only
// dependencies (Supabase, Stripe, etc.).

export type ReminderKind = "1h" | "24h";

export function firstNameOf(displayName: string | null): string | null {
  if (!displayName) return null;
  return displayName.trim().split(/\s+/)[0] || null;
}

// Formats a check-in timestamp as the studio-local visit date (the studio runs
// on Eastern time). Returns null for missing/unparseable input so the body
// gracefully omits the date.
export function formatVisitDate(visitDate: string | Date | null | undefined): string | null {
  if (!visitDate) return null;
  const d = visitDate instanceof Date ? visitDate : new Date(visitDate);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  }).format(d);
}

export function buildReminder(
  kind: ReminderKind,
  displayName: string | null,
  payUrl: string,
  visitDate?: string | Date | null
): { subject: string; html: string; text: string } {
  const first = firstNameOf(displayName);
  const hi = first ? `Hi ${first},` : "Hi,";

  const subject = "Your Potluck Sessions payment is incomplete";

  const dateStr = formatVisitDate(visitDate);
  const on = dateStr ? ` on ${dateStr}` : "";

  const intro =
    kind === "1h"
      ? `Thanks for coming to Potluck Sessions${on}. It looks like your payment didn't go through. You can take care of it here:`
      : `Your Potluck Sessions visit${on} still hasn't been paid for. You can take care of it here:`;

  const footerNote =
    "If you already paid or visited on a membership, you can ignore this.";

  const text = `${hi}

${intro}

${payUrl}

${footerNote}

Thank you!
Takes A Village`;

  // Inline styles carry the light defaults; the <style> media query overrides
  // the class-tagged elements for clients that honor prefers-color-scheme
  // (Apple Mail, iOS Mail, etc.). !important is required so the media query wins
  // over the inline styles.
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <style>
      :root { color-scheme: light dark; }
      @media (prefers-color-scheme: dark) {
        .email-page { background:#0a0a0a !important; }
        .email-card { background:#141414 !important; }
        .email-text { color:#f0f0f0 !important; }
        .email-muted { color:#9ca3af !important; }
        .email-btn { background:#ef4444 !important; }
      }
    </style>
  </head>
  <body class="email-text" style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-page" style="background:#f6f6f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-card" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;">
            <tr><td class="email-text" style="font-size:16px;line-height:1.5;color:#1a1a1a;">
              <p style="margin:0 0 16px;">${hi}</p>
              <p style="margin:0 0 24px;">${intro}</p>
              <p style="margin:0 0 28px;text-align:center;">
                <a href="${payUrl}" class="email-btn" style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:14px;">Finish paying</a>
              </p>
              <p class="email-muted" style="margin:0 0 8px;font-size:13px;color:#6b7280;">${footerNote}</p>
              <p class="email-muted" style="margin:24px 0 0;font-size:13px;color:#6b7280;">Thank you!<br/>Takes A Village</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
