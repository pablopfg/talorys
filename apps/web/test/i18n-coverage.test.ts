import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { en } from "../src/lib/i18n/en";
import { ptBR } from "../src/lib/i18n/pt-BR";

/**
 * Guards the translation workflow in CI: every English message needs a Brazilian Portuguese
 * one, and UI text must go through t() instead of being written into components.
 */

const SRC = join(__dirname, "../src");

/** Attributes that people read or hear: a string literal here is UI text. */
const TEXT_ATTRIBUTES = new Set(["label", "title", "placeholder", "aria-label", "aria-valuetext", "hint", "message", "confirmLabel", "description", "alt"]);
/** Options of useApiMutation and other calls whose string values end up in a toast. */
const TEXT_PROPERTIES = new Set(["success", "label", "hint", "title", "message"]);
/** Words that read the same in every language: product names and code. */
const ALLOWED = /^(Axis|GitHub|Workers AI|Cloudflare Workers AI|MCP|OAuth|JSON|UTC|read|write|Chrome|Edge|Firefox|Safari|iOS|Android|macOS|Windows|Linux|local)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "i18n" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Text a person would read: at least two letters, not a message key, a command or a code-like token. */
function isProse(text: string): boolean {
  const trimmed = text.trim();
  if (!/[A-Za-z]{2,}/.test(trimmed) || ALLOWED.test(trimmed) || trimmed in en || trimmed.startsWith("npx ")) return false;
  if (/^[a-z0-9_.:/-]+$/.test(trimmed) && !trimmed.includes(" ")) return false;
  return /[A-Z]|\s/.test(trimmed);
}

function hardcodedText(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const lines = source.text.split("\n");
  const report = (node: ts.Node, text: string) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    // A developer-only message (an invariant, a log) can opt out with a comment on the line above.
    if (lines[line - 2]?.includes("i18n-ignore")) return;
    found.push(`${relative(SRC, file)}:${line} ${JSON.stringify(text.trim())}`);
  };
  const literal = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && isProse(node.text)) report(node, node.text);
    if (ts.isJsxAttribute(node) && TEXT_ATTRIBUTES.has(node.name.getText())) {
      const init = node.initializer;
      const text = literal(init) ?? (init && ts.isJsxExpression(init) ? literal(init.expression) : null);
      if (text !== null && isProse(text)) report(node, text);
    }
    const inCall = !!node.parent && ts.isObjectLiteralExpression(node.parent) && ts.isCallExpression(node.parent.parent);
    if (ts.isPropertyAssignment(node) && inCall && TEXT_PROPERTIES.has(node.name.getText())) {
      const text = literal(node.initializer);
      if (text !== null && isProse(text)) report(node, text);
    }
    if (ts.isCallExpression(node) && ["toast", "Error", "setError", "setFormError"].includes(node.expression.getText())) {
      const text = literal(node.arguments[0]);
      if (text !== null && isProse(text)) report(node, text);
    }
    if (ts.isNewExpression(node) && node.expression.getText() === "Error") {
      const text = literal(node.arguments?.[0]);
      if (text !== null && isProse(text)) report(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("translations", () => {
  it("has a Brazilian Portuguese message for every English one", () => {
    const missing = Object.keys(en).filter((key) => !(key in ptBR));
    expect(missing, "add these keys to apps/web/src/lib/i18n/pt-BR.ts").toEqual([]);
  });

  it("keeps every placeholder of the English message", () => {
    const names = (message: unknown) => [...new Set(JSON.stringify(message).match(/\{\w+\}/g) ?? [])].filter((n) => n !== "{count}").sort();
    const mismatched = Object.entries(ptBR)
      .filter(([key, message]) => names(message).join() !== names(en[key as keyof typeof en]).join())
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("has no UI text written into components", () => {
    const found = sourceFiles(SRC).flatMap(hardcodedText);
    expect(found, "move this text to apps/web/src/lib/i18n/en.ts and pt-BR.ts and read it with t()").toEqual([]);
  });
});
