/**
 * Cuts `text` to at most `max` UTF-16 code units on a grapheme boundary,
 * so a family emoji or flag at the cut never leaves a joiner or a lone surrogate in a stored title or name.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    let end = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (end + segment.length > max) break;
      end += segment.length;
    }
    return text.slice(0, end);
  }
  const last = text.charCodeAt(Math.max(0, max - 1));
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * Makes model-written text safe to show as a notification: Markdown links and bare URLs become plain,
 * unclickable code, so a routine can't plant a link the owner might trust as Talorys' own.
 */
export function defangLinks(text: string): string {
  return text.replace(
    /!?\[([^\]]*)\]\(\s*([^)\s]*)[^)]*\)|<((?:https?|mailto|tel):[^>\s]*)>|\b(?:https?:\/\/|www\.)[^\s`<>]+|\b(?:mailto|tel):[^\s`<>]+/gi,
    (match, label: string | undefined, url: string | undefined, autolink: string | undefined) => {
      if (label !== undefined) return url ? `${label} (\`${url}\`)` : label;
      return `\`${autolink ?? match}\``;
    },
  );
}
