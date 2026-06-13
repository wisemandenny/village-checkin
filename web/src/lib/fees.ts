// Shared payment-fee math so the client payment UI and the server endpoints
// charge and display the exact same numbers.

// Stripe Canada online card fee: 2.9% + C$0.30 per successful charge (flat for
// all domestic cards). To net `cents` after the fee, charge `cents + fee`.
export function calcProcessingFee(cents: number): number {
  return Math.ceil((cents + 30) / (1 - 0.029)) - cents;
}

// Exclusive tier: a fixed $10.00/month support base. The processing fee is
// added on top so the village nets the full pledge.
export const EXCLUSIVE_SUPPORT_CENTS = 1000;

// Total billed to an exclusive subscriber each month (support + processor fee).
export function exclusiveMonthlyTotalCents(): number {
  return EXCLUSIVE_SUPPORT_CENTS + calcProcessingFee(EXCLUSIVE_SUPPORT_CENTS);
}
