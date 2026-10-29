import { escapeHtml } from "./client";

/** Telegram's limit is 4096 characters after entities are parsed; stay well below it. */
export const MAX_MESSAGE = 3800;

/**
 * Splits a reply into messages Telegram accepts, at paragraph, then line, then word breaks.
 * Code fences are not split specially: a fence cut in two only loses its formatting.
 */
export function splitMessage(text: string, max = MAX_MESSAGE): string[] {
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"), window.lastIndexOf(" "));
    const at = cut > max / 2 ? cut : max;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * The model's Markdown as Telegram HTML: everything is escaped first, then only bold, italics,
 * inline code and code blocks become tags. Links stay plain text (Telegram still makes bare URLs
 * clickable, without a preview), so a reply can't hide where a link goes.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const blocks: string[] = [];
  // Code first, so markers inside code stay literal.
  let html = escapeHtml(markdown)
    .replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, code: string) => `\uE000${blocks.push(`<pre>${code.replace(/\n$/, "")}</pre>`) - 1}\uE000`)
    .replace(/`([^`\n]+)`/g, (_, code: string) => `\uE000${blocks.push(`<code>${code}</code>`) - 1}\uE000`);
  html = html
    .replace(/^(\s*)[-*]\s+/gm, "$1• ")
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<i>$2</i>")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<i>$2</i>");
  return html.replace(/\uE000(\d+)\uE000/g, (_, i: string) => blocks[Number(i)]!);
}
