function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T` +
    `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

export interface IcsEventInput {
  uid: string;
  title: string;
  description?: string;
  location?: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM or HH:MM:SS
  endTime: string;
}

function parseLocalDateTime(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const parts = time.split(":").map(Number);
  const hour = parts[0] ?? 0;
  const minute = parts[1] ?? 0;
  const second = parts[2] ?? 0;
  return new Date(y, m - 1, d, hour, minute, second);
}

export function generateIcsEvent(input: IcsEventInput): string {
  const start = parseLocalDateTime(input.date, input.startTime);
  const end = parseLocalDateTime(input.date, input.endTime);
  const now = new Date();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Village Check-in//Producer Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(input.uid)}`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    `DTSTART:${formatIcsUtc(start)}`,
    `DTEND:${formatIcsUtc(end)}`,
    `SUMMARY:${escapeIcs(input.title)}`,
  ];
  if (input.description) {
    lines.push(`DESCRIPTION:${escapeIcs(input.description)}`);
  }
  if (input.location) {
    lines.push(`LOCATION:${escapeIcs(input.location)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

export function generateIcsAttachment(input: IcsEventInput): {
  filename: string;
  content: string;
} {
  return {
    filename: "booking.ics",
    content: generateIcsEvent(input),
  };
}
