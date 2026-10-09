import { describe, expect, it } from "vitest";
import { seedCases } from "./seed-cases";
import { qualify } from "../src/lib/qualify";

describe("qualification rules vs. the September enquiries", () => {
  for (const c of seedCases) {
    it(`${c.id} → ${c.expect.verdict}/${c.expect.route}`, () => {
      const q = qualify(c.facts, new Date(c.receivedAt));
      expect({ verdict: q.verdict, route: q.route }, JSON.stringify(q.criteria, null, 1)).toEqual({
        verdict: c.expect.verdict,
        route: c.expect.route,
      });
      for (const flag of c.expect.flags ?? []) expect(q.flags).toContain(flag);
    });
  }
});
