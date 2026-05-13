import { API_BASE_URL } from "./config";

export async function updateCheckInStatus(
  checkInId: string,
  status: "paid",
  stripeTransactionId?: string
) {
  const res = await fetch(`${API_BASE_URL}/api/checkin/update`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      check_in_id: checkInId,
      status,
      stripe_transaction_id: stripeTransactionId,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to update check-in: ${res.status}`);
  }

  return res.json();
}
