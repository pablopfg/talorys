import { describe, expect, it } from "vitest";
import { unlinked, unlinkForChannels } from "../src/services/text";

describe("unlinkForChannels", () => {
  it("defangs every form a Telegram or mail client would link", () => {
    expect(unlinkForChannels("See https://evil.example/login now")).toBe("See hxxps://evil[.]example/login now");
    expect(unlinkForChannels("go www.evil.com")).toBe("go www[.]evil[.]com");
    expect(unlinkForChannels("evil.example/verify")).toBe("evil[.]example/verify");
    expect(unlinkForChannels("visit evil.com.")).toBe("visit evil[.]com.");
    expect(unlinkForChannels("Abra assistente.exemplo.com.br")).toBe("Abra assistente[.]exemplo[.]com[.]br");
    // Every dot, so no client can link a prefix that looks real.
    expect(unlinkForChannels("login.talorys.com.evil.xyz")).toBe("login[.]talorys[.]com[.]evil[.]xyz");
    expect(unlinkForChannels("Verify at talorys.support or evil.com_")).toBe("Verify at talorys[.]support or evil[.]com_");
    expect(unlinkForChannels("open tg://resolve?domain=x or mailto:a@b")).toBe("open tg[:]//resolve?domain=x or mailto[:]a@b");
  });

  it("leaves ordinary text alone", () => {
    expect(unlinkForChannels("Node.js v1.2, e.g. file.txt or report.pdf")).toBe("Node.js v1.2, e.g. file.txt or report.pdf");
    expect(unlinkForChannels("Backup failed at 03:00")).toBe("Backup failed at 03:00");
  });

  it("stays fast on a long run of dots", () => {
    const start = Date.now();
    unlinkForChannels("a.".repeat(50_000));
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("keeps backticks for the app and defangs for the channels", () => {
    expect(unlinked("Sign in: https://evil.example/login")).toBe("Sign in: `hxxps://evil[.]example/login`");
    expect(unlinked("[click](https://evil.example)")).toBe("click (`hxxps://evil[.]example`)");
    expect(unlinked("[https://evil.example](x)")).toBe("hxxps://evil[.]example (`x`)");
  });
});
