// Money is held in integer cents and written as a two-decimal JSON number literal (`425.00`), never through a float
// `toFixed` and never through JSON.stringify (which would print `425`). Decision D-425: the literal parses to the number
// 425, so a v1 → v2 change from `total: 425.00` to `total_cents: 42500` stays a numeric ×100 rename, not a type change.

export class Money {
  readonly cents: number;
  constructor(cents: number) {
    if (!Number.isSafeInteger(cents)) throw new Error(`Money needs integer cents, got ${cents}`);
    this.cents = cents;
  }
  /** From a fixture value with at most two decimals (e.g. 212.5 → 21250 cents). */
  static fromDollars(dollars: number): Money {
    const cents = Math.round(dollars * 100);
    if (Math.abs(cents - dollars * 100) > 1e-6) throw new Error(`more than two decimals: ${dollars}`);
    return new Money(cents);
  }
  times(n: number): Money {
    if (!Number.isSafeInteger(n)) throw new Error(`Money.times needs an integer, got ${n}`);
    return new Money(this.cents * n);
  }
  /** The JSON literal, e.g. 42500 cents → `425.00`, -5 cents → `-0.05`. */
  literal(): string {
    const sign = this.cents < 0 ? "-" : "";
    const abs = Math.abs(this.cents);
    return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  }
}

/** JSON text like JSON.stringify(value) (compact), except that every Money is written as its two-decimal literal. */
export function toJsonText(value: unknown): string {
  if (value instanceof Money) return value.literal();
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`not JSON: ${value}`);
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v) => toJsonText(v === undefined ? null : v)).join(",")}]`;
      const parts: string[] = [];
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (v === undefined) continue;
        parts.push(`${JSON.stringify(k)}:${toJsonText(v)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`not JSON: ${typeof value}`);
  }
}
