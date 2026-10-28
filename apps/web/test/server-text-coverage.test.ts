import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SERVER_TEXT_CATALOGS } from "@talorys/shared";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Guards the translation workflow in CI for text the agent writes: every error message, tool
 * label, approval summary and run result shown to the owner needs an entry in the catalog.
 * Messages only the AI model reads (ToolError) and internal errors (Error) are not shown.
 */
describe("server text coverage", () => {
  const AGENT = join(__dirname, "../../agent/src");
  /** Error classes whose message reaches the owner, and the index of the message argument. */
  const ERRORS: Record<string, number> = { AppError: 1, ValidationError: 0, NotFoundError: 0, McpConnectionError: 1, McpEndpointError: 0 };
  /** Properties whose string value the owner reads. */
  const PROPERTIES = new Set(["label", "summary", "reason", "result", "body", "title", "invalid_reason"]);

  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));

  /** The text an expression can produce, with each interpolation as {value}. Unknown parts give null. */
  function texts(node: ts.Expression): (string | null)[] {
    if (ts.isParenthesizedExpression(node)) return texts(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) return [node.head.text + node.templateSpans.map((s) => `{value}${s.literal.text}`).join("")];
    if (ts.isConditionalExpression(node)) return [...texts(node.whenTrue), ...texts(node.whenFalse)];
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return texts(node.body);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) return texts(node.right);
    return [null];
  }

  /** Whether `text` has an entry: placeholders match any placeholder, whatever their names. */
  function covered(text: string, sources: string[]): boolean {
    const shape = (s: string) => s.replace(/\{\w+\}/g, "{}");
    if (!/[A-Za-z]{2}/.test(text.replace(/\{\w+\}/g, "")) || !/\s/.test(text)) return true;
    const target = shape(text);
    return sources.some((source) => {
      const s = shape(source);
      if (s === target) return true;
      // A {value} in the code may stand for text the catalog spells out ("Checking open tasks").
      const regex = new RegExp(`^${target.split("{}").map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]+")}$`);
      return regex.test(s) || regex.test(source);
    });
  }

  it("has a translation for every message the owner can see", () => {
    const sources = Object.keys(SERVER_TEXT_CATALOGS["pt-BR"]!);
    const missing: string[] = [];
    for (const file of files(AGENT)) {
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      const check = (node: ts.Node, expr: ts.Expression | undefined) => {
        if (!expr) return;
        for (const text of texts(expr)) {
          if (text !== null && !covered(text, sources)) {
            missing.push(`${relative(AGENT, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${JSON.stringify(text)}`);
          }
        }
      };
      const visit = (node: ts.Node) => {
        if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in ERRORS) {
          check(node, node.arguments?.[ERRORS[node.expression.text]!]);
        }
        if (ts.isPropertyAssignment(node) && PROPERTIES.has(node.name.getText())) check(node, node.initializer);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(missing, "add these to packages/shared/src/server-text.ts").toEqual([]);
  });
});
