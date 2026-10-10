import { describe, expect, it } from "vitest";
import { normalisePhone } from "../src/lib/phone";

describe("phone numbers", () => {
  it("treats Indian mobiles as +91, whatever code was guessed", () => {
    expect(normalisePhone("7039881188")).toBe("+917039881188");
    expect(normalisePhone("+17039881188")).toBe("+917039881188"); // Gemini guessed a US code
    expect(normalisePhone("07039881188")).toBe("+917039881188");
    expect(normalisePhone("+91 70398 81188")).toBe("+917039881188");
  });
  it("rejects masked or partial numbers", () => {
    expect(normalisePhone("+91 98xxx xx188")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
  });
});
