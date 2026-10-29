import { describe, expect, it } from "vitest";

const sources = import.meta.glob("../../web/src/components/SemanticRecallCard.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const card = Object.values(sources)[0] ?? "";
const messages = import.meta.glob("../../web/src/lib/i18n/en.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const en = Object.values(messages)[0] ?? "";

describe("semantic recall Settings hint", () => {
  it("R3: the hint names the item cap apart from the memory cap and the leftover comment is gone", () => {
    expect(card).not.toBe("");
    expect(card).toContain('hint={t("semantic.hint", { cap: savedCap, itemCap })}');
    expect(card).toContain("s?.items?.items_cap ?? DEFAULT_ITEM_CAP");
    expect(en).toContain("Memories use up to {cap} embeddings per day; tasks, notes and reminders have their own {itemCap} per day.");
    expect(card).not.toContain("{/* At the default cap");
  });
});
