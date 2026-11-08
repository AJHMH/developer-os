/** ADR 0008: a delivery's spend budget is the only authority a coding turn
 * needs. Money is kept in integer picodollars, so a price of $N per million
 * tokens is exactly N * 1e6 picodollars per token and every charge is exact. */

export const picodollarsPerDollar = 1e12;
export const defaultSpendBudgetDollars = 10;

/** The pinned model's first-party prices, in picodollars per token. */
export const pinnedModelPrices = Object.freeze({
  model: "claude-opus-5-5",
  input: 4_000_000,
  output: 20_000_000,
  cacheWrite5m: 5_000_000,
  cacheWrite1h: 8_000_000,
  cacheRead: 200_000,
} as const);
export type ModelPrices = typeof pinnedModelPrices;

/** The Messages API `usage` fields a charge reads. Thinking is billed inside
 * `output_tokens`. */
export interface ModelUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
}

export interface SpendLedger {
  model: ModelPrices["model"];
  budget: number;
  spent: number;
  charges: number;
  /** The one model request admitted and not yet charged. */
  reserved?: { operationId: string; amount: number };
  extensions: { added: number; at: string }[];
  /** Set when a request was refused for lack of budget; a budget extension
   * clears it. */
  interruption?: { at: string; needed: number; remaining: number };
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const operation = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Whole cents from 0.01 to 1000 dollars, as picodollars. */
export function dollarsToPicodollars(dollars: unknown): number {
  if (
    typeof dollars !== "number" ||
    !Number.isFinite(dollars) ||
    dollars < 0.01 ||
    dollars > 1000 ||
    Math.round(dollars * 100) !== Number((dollars * 100).toFixed(6))
  )
    throw Error("Declare whole cents from $0.01 to $1000.");
  return Math.round(dollars * 100) * 1e10;
}
export function picodollarsToDollars(amount: number): string {
  return `$${(amount / picodollarsPerDollar).toFixed(6)}`;
}

export function newSpendLedger(
  budget = defaultSpendBudgetDollars * picodollarsPerDollar,
): SpendLedger {
  return {
    model: pinnedModelPrices.model,
    budget,
    spent: 0,
    charges: 0,
    extensions: [],
  };
}

/** The exact cost of one response. Cache writes without a TTL breakdown are
 * charged at the dearer one-hour rate. Malformed usage throws. */
export function usageCost(
  usage: ModelUsage,
  prices: ModelPrices = pinnedModelPrices,
): number {
  const creation = usage?.cache_creation_input_tokens ?? 0,
    read = usage?.cache_read_input_tokens ?? 0,
    breakdown = usage?.cache_creation ?? undefined;
  if (
    !usage ||
    !count(usage.input_tokens) ||
    !count(usage.output_tokens) ||
    !count(creation) ||
    !count(read)
  )
    throw Error("Unverified model usage");
  let creationCost = creation * prices.cacheWrite1h;
  if (breakdown) {
    const short = breakdown.ephemeral_5m_input_tokens ?? 0,
      long = breakdown.ephemeral_1h_input_tokens ?? 0;
    if (!count(short) || !count(long) || short + long !== creation)
      throw Error("Unverified model usage");
    creationCost = short * prices.cacheWrite5m + long * prices.cacheWrite1h;
  }
  const cost =
    usage.input_tokens * prices.input +
    usage.output_tokens * prices.output +
    read * prices.cacheRead +
    creationCost;
  if (!Number.isSafeInteger(cost)) throw Error("Unverified model usage");
  return cost;
}

/** The most one request can cost: every input token at the dearest input
 * rate the request allows, and every permitted output token. */
export function requestReserve(
  request: {
    inputTokens: number;
    maxOutputTokens: number;
    longCacheWrites: boolean;
  },
  prices: ModelPrices = pinnedModelPrices,
): number {
  if (!count(request.inputTokens) || !count(request.maxOutputTokens))
    throw Error("Unverified model request");
  const inputRate = request.longCacheWrites
    ? prices.cacheWrite1h
    : prices.cacheWrite5m;
  return (
    request.inputTokens * inputRate + request.maxOutputTokens * prices.output
  );
}

export function remaining(ledger: SpendLedger): number {
  return ledger.budget - ledger.spent - (ledger.reserved?.amount ?? 0);
}

/** Admits one request whose worst case fits the remaining budget, or records
 * a budget interruption. Only one request may be outstanding. */
export function admitRequest(
  ledger: SpendLedger,
  operationId: string,
  reserve: number,
  at = new Date().toISOString(),
): { admitted: true } | { admitted: false; needed: number; remaining: number } {
  if (!operation(operationId) || !count(reserve))
    throw Error("Unverified model request");
  if (ledger.reserved) throw Error("Another model request is outstanding");
  const left = remaining(ledger);
  if (ledger.interruption || reserve > left) {
    ledger.interruption = { at, needed: reserve, remaining: left };
    return { admitted: false, needed: reserve, remaining: left };
  }
  ledger.reserved = { operationId, amount: reserve };
  return { admitted: true };
}

/** Charges the admitted request's actual cost. A cost above its reservation
 * is charged in full and reported, never hidden. */
export function chargeResponse(
  ledger: SpendLedger,
  operationId: string,
  usage: ModelUsage,
): { cost: number; overrun: boolean } {
  if (ledger.reserved?.operationId !== operationId)
    throw Error("No such admitted model request");
  const cost = usageCost(usage),
    overrun = cost > ledger.reserved.amount;
  ledger.spent += cost;
  ledger.charges += 1;
  delete ledger.reserved;
  return { cost, overrun };
}

/** Charges the admitted request's whole reservation: the provider may have
 * billed a request whose usage was never verified, and an unverified request
 * is never free. */
export function chargeReservation(
  ledger: SpendLedger,
  operationId: string,
): { cost: number; overrun: false } {
  if (ledger.reserved?.operationId !== operationId)
    throw Error("No such admitted model request");
  const cost = ledger.reserved.amount;
  ledger.spent += cost;
  ledger.charges += 1;
  delete ledger.reserved;
  return { cost, overrun: false };
}

/** Releases an admitted request that never reached the provider. */
export function releaseRequest(ledger: SpendLedger, operationId: string): void {
  if (ledger.reserved?.operationId !== operationId)
    throw Error("No such admitted model request");
  delete ledger.reserved;
}

export function extendBudget(
  ledger: SpendLedger,
  added: number,
  at = new Date().toISOString(),
): void {
  if (!count(added) || added === 0) throw Error("Invalid budget extension");
  ledger.budget += added;
  ledger.extensions.push({ added, at });
  delete ledger.interruption;
}
