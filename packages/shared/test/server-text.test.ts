import { describe, expect, it } from "vitest";
import { localizeServerText, SERVER_TEXT_CATALOGS } from "../src/server-text";

describe("localizeServerText", () => {
  it("translates exact text and fills placeholders", () => {
    expect(localizeServerText("Incorrect password.", "pt-BR")).toBe("Senha incorreta.");
    expect(localizeServerText("Talorys reached its daily limit of 50 AI requests (adjustable in Settings → AI).", "pt-BR")).toBe(
      "O Talorys atingiu o limite diário de 50 pedidos de IA (ajustável em Configurações → IA).",
    );
    expect(localizeServerText("Adding task “Buy milk”", "pt-BR")).toBe("Adicionando a tarefa “Buy milk”");
  });

  it("translates line by line and nested topics", () => {
    expect(localizeServerText("**Overdue (2)**\n- Pay rent (due seg., 3 de nov., 09:00) · high\n5 open task(s) in total.", "pt-BR")).toBe(
      "**Atrasadas (2)**\n- Pay rent (vence seg., 3 de nov., 09:00) · alta\n5 tarefa(s) aberta(s) no total.",
    );
    expect(localizeServerText("The new memory explicitly updates your car.", "pt-BR")).toBe("A nova memória atualiza explicitamente seu carro.");
  });

  it("translates a later try of an alert, title included", () => {
    expect(localizeServerText("New sign-in (2/3)", "pt-BR")).toBe("Novo login (2/3)");
    expect(localizeServerText("Alert not confirmed after 3 tries: “New sign-in”", "pt-BR")).toBe("Aviso não confirmado depois de 3 tentativas: “Novo login”");
  });

  it("keeps the field of a validation error", () => {
    expect(localizeServerText("timezone: Unknown IANA timezone", "pt-BR")).toBe("timezone: Fuso horário IANA desconhecido");
  });

  it("translates each change of a calendar approval, keeping the owner's words", () => {
    expect(localizeServerText("Change “Gym; Run” on Owner: rename to “Run”; move from 2026-11-03 14:00 – 2026-11-03 15:00 to 2026-11-03 16:00 – 2026-11-03 17:00; change the place", "pt-BR")).toBe(
      "Alterar “Gym; Run” em Owner: renomear para “Run”; mover de 2026-11-03 14:00 – 2026-11-03 15:00 para 2026-11-03 16:00 – 2026-11-03 17:00; mudar o local",
    );
  });

  it("leaves English, unknown text and other languages alone", () => {
    expect(localizeServerText("Incorrect password.", "en")).toBe("Incorrect password.");
    expect(localizeServerText("Something only the model wrote.", "pt-BR")).toBe("Something only the model wrote.");
    expect(localizeServerText("Incorrect password.", "ko")).toBe("Incorrect password.");
  });

  it("keeps every placeholder in each translation", () => {
    const names = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    for (const catalog of Object.values(SERVER_TEXT_CATALOGS)) {
      const mismatched = Object.entries(catalog).filter(([source, translation]) => names(source) !== names(translation));
      expect(mismatched).toEqual([]);
    }
  });
});
