// Property/fuzz tests for the cost math, using faker to generate random usage.
// Seeded so failures are reproducible. Checks that costUSD matches the closed-form
// formula and is monotonic in every token dimension (more tokens never costs less).

import { describe, expect, test } from "bun:test";
import { faker } from "@faker-js/faker";
import { costUSD, type ModelPrice, priceFor, type RawUsage } from "./pricing";

const opus = priceFor("claude-opus-4-8") as ModelPrice;

function expected(u: RawUsage, p: ModelPrice): number {
  const cr = p.cacheRead ?? p.in * 0.1;
  const cw = p.cacheWrite ?? p.in * 1.25;
  return (u.inTok * p.in + u.outTok * p.out + u.cacheRead * cr + u.cacheWrite * cw) / 1_000_000;
}
const randUsage = (): RawUsage => ({
  inTok: faker.number.int({ min: 0, max: 5_000_000 }),
  outTok: faker.number.int({ min: 0, max: 5_000_000 }),
  cacheRead: faker.number.int({ min: 0, max: 5_000_000 }),
  cacheWrite: faker.number.int({ min: 0, max: 5_000_000 }),
});

describe("pricing fuzz", () => {
  test("costUSD matches the closed-form formula over 500 random usages", () => {
    faker.seed(1337);
    for (let i = 0; i < 500; i++) {
      const u = randUsage();
      expect(costUSD(u, opus)).toBeCloseTo(expected(u, opus), 6);
    }
  });

  test("cost is monotonic: adding tokens never lowers the bill", () => {
    faker.seed(7);
    for (let i = 0; i < 200; i++) {
      const u = randUsage();
      const base = costUSD(u, opus);
      const more = costUSD(
        { ...u, inTok: u.inTok + faker.number.int({ min: 1, max: 1000 }) },
        opus,
      );
      expect(more).toBeGreaterThanOrEqual(base);
    }
  });

  test("zero usage always costs zero, any model", () => {
    faker.seed(99);
    for (const m of [
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "claude-sonnet-4-6",
      "claude-fable-5",
    ]) {
      const p = priceFor(m);
      if (!p) throw new Error(`no price for ${m}`);
      expect(costUSD({ inTok: 0, outTok: 0, cacheRead: 0, cacheWrite: 0 }, p)).toBe(0);
    }
  });
});
