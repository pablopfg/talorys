import { afterEach, describe, expect, it, vi } from "vitest";
import { browserLanguage } from "../src/lib/i18n";

const prefer = (...languages: string[]) => vi.stubGlobal("navigator", { languages, language: languages[0] });

describe("browserLanguage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("matches a language by its full tag", () => {
    prefer("pt-BR", "en");
    expect(browserLanguage()).toBe("pt-BR");
  });

  it("matches a regional language by its base", () => {
    prefer("pt");
    expect(browserLanguage()).toBe("pt-BR");
    prefer("pt-PT");
    expect(browserLanguage()).toBe("pt-BR");
  });

  it("matches a language without a region by its base", () => {
    prefer("fr-FR", "ko-KR");
    expect(browserLanguage()).toBe("ko");
  });

  it("falls back to English", () => {
    prefer("fr-FR");
    expect(browserLanguage()).toBe("en");
  });
});
