"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import BookingCalendar from "@/components/admin/booking-calendar";

interface BookingsPanelProps {
  token: string;
}

interface Room {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

interface TimeSlot {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  active: boolean;
  sort_order: number;
}

interface Invite {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  created_at: string;
}

type Section = "config" | "days" | "invites" | "calendar";

export default function BookingsPanel({ token }: BookingsPanelProps) {
  const [section, setSection] = useState<Section>("days");
  const [rooms, setRooms] = useState<Room[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const [newRoomName, setNewRoomName] = useState("");
  const [newSlotLabel, setNewSlotLabel] = useState("");
  const [newSlotStart, setNewSlotStart] = useState("09:00");
  const [newSlotEnd, setNewSlotEnd] = useState("12:00");

  const [openDate, setOpenDate] = useState("");
  const [openCapacity, setOpenCapacity] = useState(1);
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set());
  const [selectedTimeSlots, setSelectedTimeSlots] = useState<Set<string>>(new Set());
  const [opening, setOpening] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [sendingInvite, setSendingInvite] = useState(false);

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/admin/booking/rooms", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setRooms(data.rooms ?? []);
      setTimeSlots(data.time_slots ?? []);
      setSelectedRooms(new Set((data.rooms ?? []).filter((r: Room) => r.active).map((r: Room) => r.id)));
      setSelectedTimeSlots(
        new Set((data.time_slots ?? []).filter((t: TimeSlot) => t.active).map((t: TimeSlot) => t.id))
      );
    }
  }, [token]);

  const loadInvites = useCallback(async () => {
    const res = await fetch("/api/admin/booking/invites", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (res.ok) setInvites(data.invites ?? []);
  }, [token]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadConfig(), loadInvites()]);
      setLoading(false);
    })();
  }, [loadConfig, loadInvites]);

  async function addRoom(e: FormEvent) {
    e.preventDefault();
    if (!newRoomName.trim()) return;
    const res = await fetch("/api/admin/booking/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "room", name: newRoomName, sort_order: rooms.length }),
    });
    if (res.ok) {
      setNewRoomName("");
      await loadConfig();
    }
  }

  async function addTimeSlot(e: FormEvent) {
    e.preventDefault();
    if (!newSlotLabel.trim()) return;
    const res = await fetch("/api/admin/booking/rooms", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "time_slot",
        label: newSlotLabel,
        start_time: newSlotStart,
        end_time: newSlotEnd,
        sort_order: timeSlots.length,
      }),
    });
    if (res.ok) {
      setNewSlotLabel("");
      await loadConfig();
    }
  }

  async function openDay(e: FormEvent) {
    e.preventDefault();
    if (!openDate) return;
    setOpening(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/booking/slots", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open_day",
          date: openDate,
          capacity: openCapacity,
          room_ids: [...selectedRooms],
          time_slot_ids: [...selectedTimeSlots],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(`Opened ${data.slots?.length ?? 0} slots for ${openDate}`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to open day");
    } finally {
      setOpening(false);
    }
  }

  async function closeDay() {
    if (!openDate) return;
    if (!confirm(`Close ${openDate} and cancel all bookings on that day?`)) return;
    const res = await fetch("/api/admin/booking/slots", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "close_day", date: openDate }),
    });
    const data = await res.json();
    setMessage(res.ok ? `Closed day ${openDate}` : data.error);
  }

  async function sendInvite(e: FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setSendingInvite(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/booking/invites", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setInviteEmail("");
      setMessage(`Invite sent to ${data.invite.email}`);
      await loadInvites();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setSendingInvite(false);
    }
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tabClass = (key: Section) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      section === key
        ? "bg-[var(--color-background)] text-[var(--color-foreground)] shadow-sm"
        : "text-[var(--color-muted)] hover:text-[var(--color-foreground)]"
    }`;

  if (loading) {
    return <p className="text-[var(--color-muted)]">Loading bookings…</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {(
          [
            ["days", "Open days"],
            ["invites", "Invites"],
            ["config", "Rooms & slots"],
            ["calendar", "Calendar"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setSection(key)} className={tabClass(key)}>
            {label}
          </button>
        ))}
      </div>

      {message && (
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm">
          {message}
        </p>
      )}

      {section === "config" && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 font-semibold">Rooms</h3>
            <ul className="mb-4 space-y-1 text-sm">
              {rooms.map((r) => (
                <li key={r.id} className="flex justify-between rounded-lg border border-[var(--color-border)] px-3 py-2">
                  <span>{r.name}</span>
                  <span className="text-[var(--color-muted)]">{r.active ? "Active" : "Inactive"}</span>
                </li>
              ))}
            </ul>
            <form onSubmit={addRoom} className="flex gap-2">
              <input
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="New room name"
                className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
              <button type="submit" className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
                Add
              </button>
            </form>
          </div>
          <div>
            <h3 className="mb-3 font-semibold">Time slots</h3>
            <ul className="mb-4 space-y-1 text-sm">
              {timeSlots.map((t) => (
                <li key={t.id} className="rounded-lg border border-[var(--color-border)] px-3 py-2">
                  {t.label} ({t.start_time.slice(0, 5)}–{t.end_time.slice(0, 5)})
                </li>
              ))}
            </ul>
            <form onSubmit={addTimeSlot} className="flex flex-col gap-2">
              <input
                value={newSlotLabel}
                onChange={(e) => setNewSlotLabel(e.target.value)}
                placeholder="Label"
                className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <input
                  type="time"
                  value={newSlotStart}
                  onChange={(e) => setNewSlotStart(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                />
                <input
                  type="time"
                  value={newSlotEnd}
                  onChange={(e) => setNewSlotEnd(e.target.value)}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                />
              </div>
              <button type="submit" className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white">
                Add slot
              </button>
            </form>
          </div>
        </div>
      )}

      {section === "days" && (
        <form onSubmit={openDay} className="max-w-lg space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Date</label>
            <input
              type="date"
              value={openDate}
              onChange={(e) => setOpenDate(e.target.value)}
              required
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Capacity per slot</label>
            <input
              type="number"
              min={1}
              value={openCapacity}
              onChange={(e) => setOpenCapacity(Number(e.target.value))}
              className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Rooms</p>
            <div className="flex flex-wrap gap-2">
              {rooms.filter((r) => r.active).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => toggleSet(setSelectedRooms, r.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    selectedRooms.has(r.id)
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {r.name}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Time slots</p>
            <div className="flex flex-wrap gap-2">
              {timeSlots.filter((t) => t.active).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleSet(setSelectedTimeSlots, t.id)}
                  className={`rounded-lg border px-3 py-1.5 text-sm ${
                    selectedTimeSlots.has(t.id)
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                      : "border-[var(--color-border)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={opening}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {opening ? "Opening…" : "Open day"}
            </button>
            <button
              type="button"
              onClick={closeDay}
              className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-600"
            >
              Close day
            </button>
          </div>
        </form>
      )}

      {section === "invites" && (
        <div className="max-w-lg space-y-4">
          <form onSubmit={sendInvite} className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="producer@example.com"
              required
              className="flex-1 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={sendingInvite}
              className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {sendingInvite ? "Sending…" : "Send invite"}
            </button>
          </form>
          <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <th className="px-3 py-2 text-left">Email</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Expires</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-[var(--color-border)]/50">
                    <td className="px-3 py-2">{inv.email}</td>
                    <td className="px-3 py-2">{inv.status}</td>
                    <td className="px-3 py-2 text-[var(--color-muted)]">
                      {new Date(inv.expires_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {invites.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-center text-[var(--color-muted)]">
                      No invites yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "calendar" && <BookingCalendar token={token} />}
    </div>
  );
}
