import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  hashRecoveryCode,
  matchTotp,
  newRecoveryCode,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUri,
  totpCode,
  totpStep,
} from "../src/totp";

// RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; the RFC lists 8 digits, these are the last 6.
const RFC_SECRET = base32Encode(new TextEncoder().encode("12345678901234567890"));
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
  [20000000000, "353130"],
];

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vectors", async () => {
    expect(RFC_SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    for (const [seconds, code] of RFC_VECTORS) expect(await totpCode(RFC_SECRET, totpStep(seconds * 1000)), String(seconds)).toBe(code);
  });

  it("accepts one step of drift on each side, never a used step, never anything else", async () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    for (const offset of [-1, 0, 1]) expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, step + offset), null, now)).toBe(step + offset);
    for (const offset of [-2, 2]) expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, step + offset), null, now)).toBeNull();
    const current = await totpCode(RFC_SECRET, step);
    expect(await matchTotp(RFC_SECRET, current, step, now)).toBeNull();
    expect(await matchTotp(RFC_SECRET, await totpCode(RFC_SECRET, step - 1), step - 1, now)).toBeNull();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5x"]) expect(await matchTotp(RFC_SECRET, bad, null, now)).toBeNull();
    expect(await matchTotp(RFC_SECRET, ` ${current.slice(0, 3)} ${current.slice(3)} `, null, now)).toBe(step);
  });

  it("makes 160-bit secrets and a link authenticator apps read", () => {
    const secret = newTotpSecret();
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
    const uri = new URL(otpauthUri(secret, "Axis"));
    expect(uri.protocol).toBe("otpauth:");
    expect(uri.searchParams.get("secret")).toBe(secret);
    expect(uri.searchParams.get("issuer")).toBe("Axis");
    expect(uri.searchParams.get("digits")).toBe("6");
    expect(base32Decode("not base32!")).toBeNull();
  });
});

describe("recovery codes", () => {
  it("are 80 random bits, typed in any case and with or without dashes", async () => {
    const code = newRecoveryCode();
    expect(code).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
    const hash = await hashRecoveryCode(code);
    expect(await hashRecoveryCode(code.toLowerCase().replace(/-/g, " "))).toBe(hash);
    expect(hash).not.toContain(code.replace(/-/g, ""));
    expect(normalizeRecoveryCode("123456")).toBeNull();
    expect(await hashRecoveryCode("ABCD-EFGH")).toBeNull();
    expect(new Set(Array.from({ length: 50 }, newRecoveryCode)).size).toBe(50);
  });
});
