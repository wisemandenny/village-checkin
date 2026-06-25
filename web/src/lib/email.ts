// Transactional email via Resend (https://resend.com).
// Server-only. The generic sendEmail below uses the HTTP API directly so no
// extra dependency is needed, and follows the lazy-config pattern of
// lib/stripe.ts and lib/kit.ts: if the API key is absent the client no-ops
// (logs and returns false) so environments without email configured keep
// working. Producer booking emails use the resend SDK (below) so they can
// attach .ics calendar invites.

import { Resend } from "resend";
import { generateIcsAttachment, type IcsEventInput } from "@/lib/ics";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 15_000;

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Sends a single transactional email. Returns true on success, false when
// email is not configured or the send failed (the caller decides whether a
// failure should be retried later). Never throws.
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    console.warn("[email] RESEND_API_KEY/EMAIL_FROM not set; skipping send");
    return false;
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      console.error(`[email] Resend error ${res.status}: ${detail}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email] send failed", err);
    return false;
  }
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

function fromEmail(): string {
  return process.env.BOOKING_FROM_EMAIL || "bookings@takesavillage.studio";
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export interface SendEmailResult {
  sent: boolean;
  id?: string;
  skipped?: boolean;
}

async function sendBookingEmail(opts: {
  to: string;
  subject: string;
  html: string;
  ics?: IcsEventInput;
}): Promise<SendEmailResult> {
  const resend = getResend();
  if (!resend) {
    console.info("[email] RESEND_API_KEY unset; would send:", {
      to: opts.to,
      subject: opts.subject,
    });
    return { sent: false, skipped: true };
  }

  const attachments = opts.ics
    ? [
        {
          filename: generateIcsAttachment(opts.ics).filename,
          content: Buffer.from(generateIcsAttachment(opts.ics).content).toString("base64"),
        },
      ]
    : undefined;

  const { data, error } = await resend.emails.send({
    from: fromEmail(),
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments,
  });

  if (error) {
    console.error("[email] send failed:", error);
    return { sent: false };
  }

  return { sent: true, id: data?.id };
}

export async function sendBookingInviteEmail(opts: {
  to: string;
  token: string;
  expiresAt: string;
}): Promise<SendEmailResult> {
  const link = `${baseUrl()}/book/${opts.token}`;
  const expires = new Date(opts.expiresAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return sendBookingEmail({
    to: opts.to,
    subject: "You're invited to book studio time",
    html: `
      <p>Hi there,</p>
      <p>You've been invited to claim studio booking slots at the Village.</p>
      <p><a href="${link}">Open your booking link</a></p>
      <p>This link expires on ${expires}.</p>
      <p>— The Village</p>
    `,
  });
}

export async function sendBookingConfirmationEmail(opts: {
  to: string;
  displayName: string;
  bookings: Array<{
    date: string;
    roomName: string;
    slotLabel: string;
    startTime: string;
    endTime: string;
    bookingId: string;
  }>;
}): Promise<SendEmailResult> {
  const list = opts.bookings
    .map(
      (b) =>
        `<li>${b.date} — ${b.roomName}, ${b.slotLabel} (${b.startTime.slice(0, 5)}–${b.endTime.slice(0, 5)})</li>`
    )
    .join("");

  const first = opts.bookings[0];
  const ics =
    first &&
    ({
      uid: `booking-${first.bookingId}@village`,
      title: `Studio: ${first.roomName} (${first.slotLabel})`,
      description: `Booking for ${opts.displayName}`,
      location: first.roomName,
      date: first.date,
      startTime: first.startTime,
      endTime: first.endTime,
    } satisfies IcsEventInput);

  return sendBookingEmail({
    to: opts.to,
    subject: "Your studio bookings are confirmed",
    html: `
      <p>Hi ${opts.displayName},</p>
      <p>Your studio time is confirmed:</p>
      <ul>${list}</ul>
      <p>See you at the Village!</p>
    `,
    ics: opts.bookings.length === 1 ? ics : undefined,
  });
}

export async function sendBookingReminderEmail(opts: {
  to: string;
  displayName: string;
  date: string;
  roomName: string;
  slotLabel: string;
  startTime: string;
  endTime: string;
  bookingId: string;
}): Promise<SendEmailResult> {
  return sendBookingEmail({
    to: opts.to,
    subject: `Reminder: studio booking on ${opts.date}`,
    html: `
      <p>Hi ${opts.displayName},</p>
      <p>This is a reminder that you have studio time coming up:</p>
      <p><strong>${opts.date}</strong> — ${opts.roomName}, ${opts.slotLabel} (${opts.startTime.slice(0, 5)}–${opts.endTime.slice(0, 5)})</p>
      <p>See you at the Village!</p>
    `,
    ics: {
      uid: `booking-reminder-${opts.bookingId}@village`,
      title: `Studio: ${opts.roomName} (${opts.slotLabel})`,
      description: `Booking reminder for ${opts.displayName}`,
      location: opts.roomName,
      date: opts.date,
      startTime: opts.startTime,
      endTime: opts.endTime,
    },
  });
}
