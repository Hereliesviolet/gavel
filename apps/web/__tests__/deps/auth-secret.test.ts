import { describe, expect, it } from "vitest";
import { readAuthSecret, requireAuthSecret } from "@/lib/auth-secret";

describe("auth secret", () => {
  it("liest AUTH_SECRET vor NEXTAUTH_SECRET", () => {
    expect(readAuthSecret({ AUTH_SECRET: "a", NEXTAUTH_SECRET: "b" })).toBe("a");
    expect(readAuthSecret({ NEXTAUTH_SECRET: " b " })).toBe("b");
    expect(readAuthSecret({ AUTH_SECRET: "  " })).toBeNull();
    expect(readAuthSecret({})).toBeNull();
  });

  it("wirft ohne Secret", () => {
    expect(() => requireAuthSecret({})).toThrow(/AUTH_SECRET/);
    expect(requireAuthSecret({ AUTH_SECRET: "x" })).toBe("x");
  });
});
