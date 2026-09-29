import { describe, expect, it } from "vitest";
import { passwordPolicyError } from "@/lib/password-policy";

describe("passwordPolicyError", () => {
  it("lehnt zu kurze und einseitige Passwörter ab", () => {
    expect(passwordPolicyError("kurz1")).toMatch(/mindestens 10/);
    expect(passwordPolicyError("nurBuchstaben")).toMatch(/Buchstaben und eine Ziffer/);
    expect(passwordPolicyError("1234567890")).toMatch(/Buchstaben und eine Ziffer/);
  });

  it("akzeptiert gemischte Passwörter", () => {
    expect(passwordPolicyError("Gavel-Test-123")).toBeNull();
  });
});
