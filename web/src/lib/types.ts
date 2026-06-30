export type SubscriptionInterval = "week" | "month";

export interface VillagerSubscriptionSummary {
  status: string;
  amount: number;
  interval: SubscriptionInterval;
}

export interface Villager {
  id: string;
  device_ids: string[];
  display_name: string;
  ig_handle: string | null;
  roles: string[];
  instruments: string[];
  email: string | null;
  marketing_opt_in: boolean;
  test_account: boolean;
  exclude_from_new: boolean;
  stripe_customer_id: string | null;
  kit_subscriber_id: string | null;
  avatar_head: number | null;
  avatar_body: number | null;
  selfie_url: string | null;
  first_visited_at: string;
  last_visited_at: string | null;
  subscription?: VillagerSubscriptionSummary | null;
}

export interface Subscription {
  id: string;
  villager_id: string;
  stripe_subscription_id: string;
  status: string;
  amount: number;
  interval: SubscriptionInterval;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
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

export type PaymentMethod = "terminal" | "online_fallback" | "cash" | "skipped" | "deferred" | "subscription" | "elder";
export type CheckInStatus = "pending" | "paid" | "skipped";

export interface StudioSettings {
  payments_enabled: boolean;
  admin_password: string | null;
  maintenance_mode: boolean;
}
