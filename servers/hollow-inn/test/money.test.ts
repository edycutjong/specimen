import { describe, expect, it } from "vitest";
import { Money, toJsonText } from "../src/money.js";

describe("money literal (D-425)", () => {
  it("writes two decimals from integer cents", () => {
    expect(new Money(42500).literal()).toBe("425.00");
    expect(new Money(21250).literal()).toBe("212.50");
    expect(new Money(5).literal()).toBe("0.05");
    expect(new Money(-5).literal()).toBe("-0.05");
    expect(new Money(0).literal()).toBe("0.00");
  });
  it("converts fixture dollars without float drift", () => {
    expect(Money.fromDollars(212.5).cents).toBe(21250);
    expect(Money.fromDollars(168.4).times(3).cents).toBe(50520);
    expect(() => Money.fromDollars(1.005)).toThrow();
    expect(() => new Money(0.5)).toThrow();
  });
  it("serialises like compact JSON.stringify except money", () => {
    const v = { a: 1, b: "x\"y", c: [true, null], d: new Money(42500), e: undefined };
    expect(toJsonText(v)).toBe('{"a":1,"b":"x\\"y","c":[true,null],"d":425.00}');
    expect(JSON.parse(toJsonText(v)).d).toBe(425);
    const plain = { k: [1, 2.5, "é"], n: { m: false } };
    expect(toJsonText(plain)).toBe(JSON.stringify(plain));
  });
});
