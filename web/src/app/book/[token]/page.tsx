"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { getOrCreateDeviceId, setDeviceId } from "@/lib/device-id";
import { Role } from "@/lib/tag-order";
import { Spinner } from "@/components/motion";

interface OpenSlot {
  id: string;
  date: string;
  capacity: number;
  remaining: number;
  booked_by_me: boolean;
  room: { id: string; name: string } | null;
  time_slot: { id: string; label: string; start_time: string; end_time: string } | null;
}

interface MyBooking {
  id: string;
  status: string;
  booking_slots: {
    date: string;
    rooms: { name: string } | null;
    time_slots: { label: string; start_time: string; end_time: string } | null;
  } | null;
}

type Step = "loading" | "onboarding" | "book" | "error";

export default function BookPage() {
  const params = useParams();
  const token = params.token as string;

  const [deviceId] = useState(() =>
    typeof window !== "undefined" ? getOrCreateDeviceId().deviceId : ""
  );
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [openSlots, setOpenSlots] = useState<OpenSlot[]>([]);
  const [myBookings, setMyBookings] = useState<MyBooking[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [claiming, setClaiming] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [view, setView] = useState<"pick" | "manage">("pick");

  const loadInvite = useCallback(async (devId: string) => {
    setStep("loading");
    setError("");
    try {
      const res = await fetch(`/api/booking/invite/${token}`, {
        headers: { "x-device-id": devId },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Invalid invite");
        setStep("error");
        return;
      }

      setInviteEmail(data.invite.email);
      setOpenSlots(data.open_slots ?? []);
      setMyBookings(data.my_bookings ?? []);

      if (data.needs_onboarding) {
        setStep("onboarding");
      } else {
        setDisplayName(data.villager?.display_name ?? "");
        setStep("book");
      }
    } catch {
      setError("Failed to load invite");
      setStep("error");
    }
  }, [token]);

  useEffect(() => {
    if (!deviceId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch invite on mount
    void loadInvite(deviceId);
  }, [deviceId, loadInvite]);

  const slotsByDate = useMemo(() => {
    const map = new Map<string, OpenSlot[]>();
    for (const slot of openSlots) {
      if (!map.has(slot.date)) map.set(slot.date, []);
      map.get(slot.date)!.push(slot);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [openSlots]);

  function toggleSlot(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleClaim() {
    if (!deviceId || selected.size === 0) return;
    setClaiming(true);
    setError("");
    try {
      const res = await fetch("/api/booking/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          device_id: deviceId,
          booking_slot_ids: [...selected],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Booking failed");
      setSelected(new Set());
      await loadInvite(deviceId);
      setView("manage");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setClaiming(false);
    }
  }

  async function handleCancel(bookingId: string) {
    if (!deviceId) return;
    setCancelling(bookingId);
    setError("");
    try {
      const res = await fetch("/api/booking/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, device_id: deviceId, booking_id: bookingId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cancel failed");
      await loadInvite(deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(null);
    }
  }

  function formatDate(d: string) {
    return new Date(d + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  if (step === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
        <h1 className="mb-2 text-xl font-bold">Booking unavailable</h1>
        <p className="text-[var(--color-muted)]">{error}</p>
      </div>
    );
  }

  if (step === "onboarding" && deviceId) {
    return (
      <div className="mx-auto flex min-h-screen max-w-lg flex-col items-center px-4 py-12">
        <h1 className="mb-2 text-2xl font-bold font-[family-name:var(--font-domaine)]">
          Welcome to the Village
        </h1>
        <p className="mb-8 text-center text-sm text-[var(--color-muted)]">
          Set up your profile, then pick your studio slots.
        </p>
        <OnboardingForm
          deviceId={deviceId}
          initialEmail={inviteEmail}
          lockedEmail
          defaultRoles={[Role.Producer]}
          hideRecover
          registerUrl="/api/booking/onboard"
          extraRegisterBody={{ token }}
          onComplete={(name) => {
            setDeviceId(deviceId);
            setDisplayName(name);
            loadInvite(deviceId);
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-[family-name:var(--font-domaine)]">
            Studio Booking
          </h1>
          {displayName && (
            <p className="text-sm text-[var(--color-muted)]">Hi, {displayName}</p>
          )}
        </div>
        <div className="flex gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
          <button
            type="button"
            onClick={() => setView("pick")}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "pick" ? "bg-[var(--color-background)] shadow-sm" : "text-[var(--color-muted)]"}`}
          >
            Book
          </button>
          <button
            type="button"
            onClick={() => setView("manage")}
            className={`rounded-md px-3 py-1.5 text-sm ${view === "manage" ? "bg-[var(--color-background)] shadow-sm" : "text-[var(--color-muted)]"}`}
          >
            My bookings ({myBookings.length})
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

      {view === "pick" && (
        <>
          {slotsByDate.length === 0 ? (
            <p className="text-[var(--color-muted)]">No open slots right now. Check back soon!</p>
          ) : (
            <div className="flex flex-col gap-6">
              {slotsByDate.map(([date, slots]) => (
                <section key={date}>
                  <h2 className="mb-3 text-lg font-semibold">{formatDate(date)}</h2>
                  <div className="grid gap-2">
                    {slots.map((slot) => {
                      const isSelected = selected.has(slot.id);
                      const disabled = slot.remaining <= 0 && !slot.booked_by_me;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => !disabled && toggleSlot(slot.id)}
                          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10"
                              : disabled
                                ? "border-[var(--color-border)] opacity-40 cursor-not-allowed"
                                : "border-[var(--color-border)] hover:border-[var(--color-accent)]/40"
                          }`}
                        >
                          <span>
                            <span className="font-medium">{slot.room?.name}</span>
                            <span className="text-[var(--color-muted)]">
                              {" "}
                              · {slot.time_slot?.label} (
                              {slot.time_slot?.start_time.slice(0, 5)}–
                              {slot.time_slot?.end_time.slice(0, 5)})
                            </span>
                          </span>
                          <span className="text-sm text-[var(--color-muted)]">
                            {slot.booked_by_me
                              ? "Booked"
                              : `${slot.remaining}/${slot.capacity} left`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {selected.size > 0 && (
            <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--color-border)] bg-[var(--color-background)] p-4">
              <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
                <span className="text-sm">{selected.size} slot(s) selected</span>
                <button
                  type="button"
                  disabled={claiming}
                  onClick={handleClaim}
                  className="rounded-xl bg-[var(--color-accent)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {claiming ? "Confirming…" : "Confirm bookings"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {view === "manage" && (
        <div className="flex flex-col gap-3">
          {myBookings.length === 0 ? (
            <p className="text-[var(--color-muted)]">You have no upcoming bookings.</p>
          ) : (
            myBookings.map((b) => {
              const slot = b.booking_slots;
              return (
                <div
                  key={b.id}
                  className="flex items-center justify-between rounded-xl border border-[var(--color-border)] px-4 py-3"
                >
                  <div>
                    <p className="font-medium">
                      {slot?.date && formatDate(slot.date)}
                    </p>
                    <p className="text-sm text-[var(--color-muted)]">
                      {slot?.rooms?.name} · {slot?.time_slots?.label}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={cancelling === b.id}
                    onClick={() => handleCancel(b.id)}
                    className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
                  >
                    {cancelling === b.id ? "Cancelling…" : "Cancel"}
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
