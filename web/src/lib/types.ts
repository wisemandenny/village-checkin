export interface Attendee {
  id: string;
  device_id: string;
  display_name: string;
  primary_role: string | null;
  email: string | null;
  marketing_opt_in: boolean;
  first_visited_at: string;
  last_visited_at: string | null;
}

export interface CheckIn {
  id: string;
  attendee_id: string;
  intent_amount: number;
  payment_method: PaymentMethod;
  status: CheckInStatus;
  created_at: string;
  stripe_transaction_id: string | null;
}

export type PaymentMethod = "terminal" | "online_fallback" | "cash" | "skipped";
export type CheckInStatus = "pending" | "paid";
