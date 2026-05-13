import { useEffect, useState, useCallback, useRef } from "react";
import { StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { StatusBar } from "expo-status-bar";
import {
  StripeTerminalProvider,
  useStripeTerminal,
} from "@stripe/stripe-terminal-react-native";
import { supabase } from "./src/supabase";
import { updateCheckInStatus } from "./src/api";
import { API_BASE_URL } from "./src/config";

interface PaymentPayload {
  check_in_id: string;
  amount: number;
}

type KioskState = "idle" | "collecting" | "processing" | "success" | "error";

function fetchTokenProvider(): Promise<string> {
  return fetch(`${API_BASE_URL}/api/terminal-token`, {
    method: "POST",
  })
    .then((res) => res.json())
    .then((data) => data.secret);
}

function KioskScreen() {
  const [state, setState] = useState<KioskState>("idle");
  const [payload, setPayload] = useState<PaymentPayload | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { discoverReaders, connectLocalMobileReader, collectPaymentMethod, confirmPaymentIntent } =
    useStripeTerminal();

  const resetToIdle = useCallback((delay = 4000) => {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => {
      setState("idle");
      setPayload(null);
      setErrorMsg("");
    }, delay);
  }, []);

  const handlePayment = useCallback(
    async (p: PaymentPayload) => {
      setPayload(p);
      setState("collecting");

      try {
        // Discover and connect to local mobile reader (tap-to-pay)
        const { discoveredReaders } = await discoverReaders({
          discoveryMethod: "localMobile",
          simulated: false,
        });

        if (discoveredReaders && discoveredReaders.length > 0) {
          await connectLocalMobileReader({
            reader: discoveredReaders[0],
          });
        }

        // Create a PaymentIntent via the backend, then collect
        const piRes = await fetch(`${API_BASE_URL}/api/terminal-payment-intent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: p.amount }),
        });
        const { client_secret } = await piRes.json();

        const { paymentIntent: collectedPI } = await collectPaymentMethod({ clientSecret: client_secret });

        if (!collectedPI) throw new Error("Payment collection cancelled");

        setState("processing");

        const { paymentIntent: confirmedPI } = await confirmPaymentIntent({ paymentIntent: collectedPI });

        if (confirmedPI?.status === "succeeded" || confirmedPI?.status === "requires_capture") {
          await updateCheckInStatus(p.check_in_id, "paid", confirmedPI.id);
          setState("success");
          resetToIdle();
        } else {
          throw new Error("Payment not confirmed");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Payment failed";
        setErrorMsg(msg);
        setState("error");
        resetToIdle(6000);
      }
    },
    [discoverReaders, connectLocalMobileReader, collectPaymentMethod, confirmPaymentIntent, resetToIdle]
  );

  // Subscribe to Supabase Realtime for payment requests
  useEffect(() => {
    const channel = supabase
      .channel("terminal_room")
      .on("broadcast", { event: "payment_request" }, ({ payload: p }) => {
        if (state === "idle" && p) {
          handlePayment(p as PaymentPayload);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [state, handlePayment]);

  const formatDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  return (
    <View style={styles.container}>
      <StatusBar style="light" hidden />

      {state === "idle" && (
        <View style={styles.center}>
          <Text style={styles.idleTitle}>Village Studio</Text>
          <Text style={styles.idleSubtitle}>
            Tap your phone to the sticker on the corner to check in.
          </Text>
          <View style={styles.pulse} />
        </View>
      )}

      {state === "collecting" && payload && (
        <View style={styles.center}>
          <Text style={styles.payTitle}>
            Please tap your card for {formatDollars(payload.amount)}
          </Text>
          <ActivityIndicator size="large" color="#a78bfa" style={{ marginTop: 24 }} />
        </View>
      )}

      {state === "processing" && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#a78bfa" />
          <Text style={styles.processingText}>Processing...</Text>
        </View>
      )}

      {state === "success" && (
        <View style={styles.center}>
          <View style={styles.successCircle}>
            <Text style={styles.checkmark}>✓</Text>
          </View>
          <Text style={styles.successText}>Payment Complete</Text>
        </View>
      )}

      {state === "error" && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorMsg || "Something went wrong"}</Text>
          <Text style={styles.errorSubtext}>Returning to idle...</Text>
        </View>
      )}
    </View>
  );
}

export default function App() {
  return (
    <StripeTerminalProvider logLevel="verbose" tokenProvider={fetchTokenProvider}>
      <KioskScreen />
    </StripeTerminalProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  idleTitle: {
    fontSize: 48,
    fontWeight: "800",
    color: "#ffffff",
    marginBottom: 16,
  },
  idleSubtitle: {
    fontSize: 22,
    color: "#9ca3af",
    textAlign: "center",
    lineHeight: 32,
  },
  pulse: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(167, 139, 250, 0.15)",
    marginTop: 48,
  },
  payTitle: {
    fontSize: 36,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  processingText: {
    fontSize: 24,
    color: "#9ca3af",
    marginTop: 16,
  },
  successCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(34, 197, 94, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  checkmark: {
    fontSize: 48,
    color: "#22c55e",
  },
  successText: {
    fontSize: 32,
    fontWeight: "700",
    color: "#22c55e",
  },
  errorText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#ef4444",
    textAlign: "center",
  },
  errorSubtext: {
    fontSize: 16,
    color: "#9ca3af",
    marginTop: 12,
  },
});
