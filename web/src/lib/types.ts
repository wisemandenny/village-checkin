export interface Villager {
  id: string;
  device_id: string;
  display_name: string;
  ig_handle: string | null;
  roles: string[];
  instruments: string[];
  email: string | null;
  marketing_opt_in: boolean;
  first_visited_at: string;
  last_visited_at: string | null;
}

export interface CheckIn {
  id: string;
  villager_id: string;
  intent_amount: number;
  payment_method: PaymentMethod;
  status: CheckInStatus;
  created_at: string;
  stripe_transaction_id: string | null;
}

export type PaymentMethod = "terminal" | "online_fallback" | "cash" | "skipped" | "deferred";
export type CheckInStatus = "pending" | "paid" | "skipped";
