import { describe, expect, it, vi } from "vitest";
import { checkPasswordStrength, isBreachedPassword, meetsLegacyPolicy } from "../src/password-policy";
import { hashPassword, isPasswordHash, isPepperedHash, verifyPassword, hmacSha256Hex, timingSafeEqual } from "../src/crypto";
import { settingsSchema, backupSchema, taskCreateSchema } from "../src/schemas";

describe("password policy", () => {
  it("asks for 15 characters, not a mix of character types (NIST SP 800-63B)", () => {
    expect(checkPasswordStrength("Sunny-Garden-42")).toBeNull();
    expect(checkPasswordStrength("alllowercaseletters")).toBeNull();
    expect(checkPasswordStrength("a long passphrase of words")).toBeNull();
    expect(checkPasswordStrength("Sunny-Garden-4")).toMatch(/at least 15/);
    // Each code point is one character, so 15 emoji are long enough and 7 aren't.
    expect(checkPasswordStrength("🔐🌻🐝🍀🌙⭐🎈🎉🌈🍎🍊🍋🍉🍇🍓")).toBeNull();
    expect(checkPasswordStrength("🔐🌻🐝🍀🌙⭐🎈")).toMatch(/at least/);
    expect(checkPasswordStrength("x".repeat(257))).toMatch(/at most 256/);
  });

  it("refuses repeats and common words", () => {
    expect(checkPasswordStrength("a".repeat(20))).toMatch(/repeating/);
    expect(checkPasswordStrength("🔐".repeat(16))).toMatch(/repeating/);
    expect(checkPasswordStrength("🇺🇸".repeat(16))).toMatch(/repeating/);
    expect(checkPasswordStrength("👨‍👩‍👧‍👦".repeat(16))).toMatch(/repeating/);
    expect(checkPasswordStrength("password1234567")).toMatch(/common/);
    expect(checkPasswordStrength("minhasenha12345")).toMatch(/common/);
  });

  it("keeps passwords set under the old 10-character rule usable", () => {
    expect(meetsLegacyPolicy("Sunny-Gard")).toBe(true);
    expect(meetsLegacyPolicy("short-pw1")).toBe(false);
    expect(meetsLegacyPolicy("a".repeat(12))).toBe(false);
  });
});

describe("breached password check (k-anonymity)", () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const answer = (body: string, status = 200) =>
    vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(body, { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it("sends only the first five characters of the SHA-1, with padding asked for", async () => {
    const fetcher = answer("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n0000000000000000000000000000000000A:0");
    expect(await isBreachedPassword("password", fetcher)).toBe(true);
    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(url)).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(JSON.stringify(init)).not.toContain("password");
    expect((init as RequestInit).headers).toMatchObject({ "add-padding": "true" });
  });

  it("ignores padding entries and reports unknown when the service fails", async () => {
    expect(await isBreachedPassword("password", answer("1E4C9B93F3F0682250B6CF8331B7EE68FD8:0"))).toBe(false);
    expect(await isBreachedPassword("Sunny-Garden-42", answer("ABCDEF:3"))).toBe(false);
    expect(await isBreachedPassword("password", answer("", 503))).toBeNull();
    const down = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await isBreachedPassword("password", down)).toBeNull();
  });
});

describe("password hashing", () => {
  it("round-trips and resists tampering", async () => {
    const hash = await hashPassword("Sunny-Garden-42");
    expect(isPasswordHash(hash)).toBe(true);
    expect(hash).not.toContain("Sunny");
    expect(await verifyPassword("Sunny-Garden-42", hash)).toBe(true);
    expect(await verifyPassword("sunny-garden-42", hash)).toBe(false);
    // Tamper the first hash character: the last one partly holds base64 padding bits.
    const sep = hash.lastIndexOf("$") + 1;
    const tampered = hash.slice(0, sep) + (hash[sep] === "A" ? "B" : "A") + hash.slice(sep + 1);
    expect(await verifyPassword("Sunny-Garden-42", tampered)).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "pbkdf2-sha256$1$abc$def")).toBe(false); // too few iterations
    expect(await verifyPassword("x", "pbkdf2-sha256$50000$c2FsdA$a")).toBe(false); // regex-valid but invalid base64url hash length (throws in atob)
    expect(await verifyPassword("x", "pbkdf2-sha256$50000$a$aGFzaA")).toBe(false); // regex-valid but invalid base64url salt length (throws in atob)
  });

  it("with a pepper, the hash is useless without it", async () => {
    const pepper = "p".repeat(16) + "e".repeat(16);
    const hash = await hashPassword("Sunny-Garden-42", { pepper });
    expect(isPepperedHash(hash)).toBe(true);
    expect(hash.startsWith("pbkdf2-sha256-p1$100000$")).toBe(true);
    expect(await verifyPassword("Sunny-Garden-42", hash, pepper)).toBe(true);
    expect(await verifyPassword("Sunny-Garden-42", hash)).toBe(false);
    expect(await verifyPassword("Sunny-Garden-42", hash, "q".repeat(32))).toBe(false);
    // A pepper too short to matter is not used, and an unpeppered hash ignores the pepper.
    expect(isPepperedHash(await hashPassword("Sunny-Garden-42", { pepper: "short" }))).toBe(false);
    expect(await verifyPassword("Sunny-Garden-42", await hashPassword("Sunny-Garden-42"), pepper)).toBe(true);
  });

  it("uses unique salts", async () => {
    expect(await hashPassword("same-Password-1")).not.toBe(await hashPassword("same-Password-1"));
  });

  it("HMAC and constant-time comparison behave", async () => {
    expect(await hmacSha256Hex("k", "v")).toMatch(/^[0-9a-f]{64}$/);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
  });
});

describe("input schemas", () => {
  it("validates settings, tasks and backups", () => {
    expect(settingsSchema.shape.timezone.safeParse("Mars/Base").success).toBe(false);
    expect(settingsSchema.shape.model.safeParse("https://evil.example/model").success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(backupSchema.safeParse({ format: "other", version: 1, exported_at: "", data: {} }).success).toBe(false);
  });
});
