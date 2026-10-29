import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, onReauthRequired } from "../src/lib/api";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const reauth = () => reply(403, { error: { code: "REAUTH_REQUIRED", message: "Confirm your password to continue." } });

afterEach(() => vi.unstubAllGlobals());

describe("api() and password confirmation", () => {
  it("asks once, then retries the same request", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(reauth()).mockResolvedValueOnce(reply(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetch);
    const ask = vi.fn().mockResolvedValue(true);
    const off = onReauthRequired(ask);
    try {
      await expect(api("/export")).resolves.toEqual({ ok: 1 });
    } finally {
      off();
    }
    expect(ask).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]![0]).toBe("/api/export");
  });

  it("gives up when the owner cancels, or when the retry is refused again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reauth()));
    const off = onReauthRequired(async () => false);
    await expect(api("/export")).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
    off();
    const off2 = onReauthRequired(async () => true);
    await expect(api("/export")).rejects.toBeInstanceOf(ApiError);
    off2();
  });

  it("without a dialog mounted, the error goes to the caller", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reauth()));
    await expect(api("/export")).rejects.toMatchObject({ code: "REAUTH_REQUIRED", status: 403 });
  });
});
