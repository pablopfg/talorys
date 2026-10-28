import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../src/components/Markdown";

const html = (content: string, plainLinks = true) => renderToStaticMarkup(createElement(Markdown, { content, plainLinks }));

describe("notification bodies never carry a clickable link", () => {
  it.each([
    ["inline", "[Renew your session](https://evil.example/login)"],
    ["nested brackets", "[a [b] c](//evil.example/x)"],
    ["escaped bracket", "[a\\]b](//evil.example/x)"],
    ["reference style", "[click][r]\n\n[r]: //evil.example/x"],
    ["autolink", "<https://evil.example>"],
    ["bare URL", "see https://evil.example/x now"],
    ["www", "see www.evil.example now"],
    ["email", "write to bob@evil.example"],
  ])("%s", (_name, content) => {
    const out = html(content);
    expect(out).not.toContain("<a ");
    expect(out).toContain("evil.example");
  });

  it("shows the address next to the label", () => {
    expect(html("[Renew](https://evil.example/login)")).toContain("Renew (<code>https://evil.example/login</code>)");
    expect(html("write to bob@evil.example")).toContain("<code>bob@evil.example</code>");
  });

  it("leaves links clickable everywhere else", () => {
    expect(html("[docs](https://example.com)", false)).toContain('<a href="https://example.com"');
  });
});
