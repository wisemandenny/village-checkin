"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

interface BookingCalendarProps {
  token: string;
}

interface DayBooking {
  booking_id: string;
  villager_id: string;
  display_name: string;
  room_id: string;
}

const COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-indigo-500",
];

function colorForId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i) * 17) % COLORS.length;
  return COLORS[hash];
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export default function BookingCalendar({ token }: BookingCalendarProps) {
  const [view, setView] = useState<"month" | "day">("month");
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [monthDays, setMonthDays] = useState<Record<string, DayBooking[]>>({});
  const [dayGrid, setDayGrid] = useState<
    Array<{
      room: { id: string; name: string };
      slots: Array<{
        time_slot: { id: string; label: string; start_time: string; end_time: string };
        booking_slot: { id: string; capacity: number; status: string; remaining: number } | null;
        bookings: Array<{ id: string; villager: { display_name: string } | null }>;
      }>;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadMonth = useCallback(
    async (targetMonth?: string) => {
      const m = targetMonth ?? month;
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/admin/booking/calendar?view=month&month=${m}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setMonthDays(data.days ?? {});
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [month, token]
  );

  const loadDay = useCallback(
    async (date: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(
          `/api/admin/booking/calendar?view=day&date=${date}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setDayGrid(data.grid ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (view === "month") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch calendar month
      void loadMonth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when view/month changes
  }, [view, month]);

  useEffect(() => {
    if (view === "day" && selectedDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch calendar day
      void loadDay(selectedDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when day selection changes
  }, [view, selectedDate]);

  function shiftMonth(delta: number) {
    const [y, m] = month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  function renderMonthGrid() {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0).getDate();
    const startPad = first.getDay();
    const cells: ReactNode[] = [];

    for (let i = 0; i < startPad; i++) {
      cells.push(<div key={`pad-${i}`} className="min-h-24 border border-transparent" />);
    }

    for (let day = 1; day <= lastDay; day++) {
      const dateStr = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const bookings = monthDays[dateStr] ?? [];
      cells.push(
        <button
          key={dateStr}
          type="button"
          onClick={() => {
            setSelectedDate(dateStr);
            setView("day");
          }}
          className="min-h-24 rounded-lg border border-[var(--color-border)] p-2 text-left transition hover:border-[var(--color-accent)]/50"
        >
          <span className="text-sm font-medium">{day}</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {bookings.map((b) => (
              <span
                key={b.booking_id}
                title={b.display_name}
                className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white ${colorForId(b.villager_id)}`}
              >
                {initial(b.display_name)}
              </span>
            ))}
          </div>
        </button>
      );
    }

    return cells;
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (view === "month" ? shiftMonth(-1) : setView("month"))}
            className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm"
          >
            ←
          </button>
          <h3 className="text-lg font-semibold">
            {view === "month"
              ? new Date(month + "-01T12:00:00").toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })
              : selectedDate &&
                new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
          </h3>
          <button
            type="button"
            onClick={() => view === "month" && shiftMonth(1)}
            className="rounded-lg border border-[var(--color-border)] px-2 py-1 text-sm"
          >
            →
          </button>
        </div>
        {view === "day" && (
          <button
            type="button"
            onClick={() => setView("month")}
            className="text-sm text-[var(--color-accent)] underline"
          >
            Back to month
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
      {loading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}

      {view === "month" && !loading && (
        <>
          <div className="mb-2 grid grid-cols-7 gap-1 text-center text-xs text-[var(--color-muted)]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d}>{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">{renderMonthGrid()}</div>
        </>
      )}

      {view === "day" && !loading && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)]">
                <th className="py-2 text-left font-medium">Time</th>
                {dayGrid.map((row) => (
                  <th key={row.room.id} className="px-2 py-2 text-left font-medium">
                    {row.room.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(dayGrid[0]?.slots ?? []).map((_, slotIdx) => (
                <tr key={slotIdx} className="border-b border-[var(--color-border)]/50">
                  <td className="py-2 pr-4 text-[var(--color-muted)]">
                    {dayGrid[0]?.slots[slotIdx]?.time_slot.label}
                    <br />
                    <span className="text-xs">
                      {dayGrid[0]?.slots[slotIdx]?.time_slot.start_time.slice(0, 5)}–
                      {dayGrid[0]?.slots[slotIdx]?.time_slot.end_time.slice(0, 5)}
                    </span>
                  </td>
                  {dayGrid.map((row) => {
                    const cell = row.slots[slotIdx];
                    return (
                      <td key={row.room.id} className="px-2 py-2 align-top">
                        {cell?.booking_slot ? (
                          <div className="rounded-lg border border-[var(--color-border)] p-2">
                            <p className="mb-1 text-xs text-[var(--color-muted)]">
                              {cell.booking_slot.status === "open" ? "Open" : "Closed"} ·{" "}
                              {cell.bookings.length}/{cell.booking_slot.capacity}
                            </p>
                            <ul className="space-y-1">
                              {cell.bookings.map((b) => (
                                <li
                                  key={b.id}
                                  className="flex items-center gap-1.5 text-xs"
                                >
                                  <span
                                    className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white ${colorForId(b.villager?.display_name ?? b.id)}`}
                                  >
                                    {initial(b.villager?.display_name ?? "?")}
                                  </span>
                                  {b.villager?.display_name ?? "Unknown"}
                                </li>
                              ))}
                              {cell.bookings.length === 0 && (
                                <li className="text-xs text-[var(--color-muted)]">—</li>
                              )}
                            </ul>
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">Not opened</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
