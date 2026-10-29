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
 * The link pattern is written so a missing `)` never makes it backtrack over the rest of the text.
 */
export function defangLinks(text: string): string {
  return text.replace(
    // (?=(x))\N matches x atomically (JavaScript has no possessive quantifiers), so the spaces and
    // the URL are never re-split when the closing ")" is missing.
    /!?\[([^\]]*)\]\((?=(\s*))\2(?=([^)\s]*))\3[^)]*\)|<((?:https?|mailto|tel):[^>\s]*)>|\b(?:https?:\/\/|www\.)[^\s`<>]+|\b(?:mailto|tel):[^\s`<>]+/gi,
    (match, label: string | undefined, _space: string | undefined, url: string | undefined, autolink: string | undefined) => {
      if (label !== undefined) return url ? `${label} (\`${url}\`)` : label;
      return `\`${autolink ?? match}\``;
    },
  );
}

// Top-level domains that Telegram and mail clients turn into links even without "http" or "www.".
const LINKED_TLDS =
  "com|net|org|info|biz|io|co|me|app|dev|ai|xyz|top|site|online|link|ly|gg|ru|cn|br|pt|us|uk|de|fr|es|eu|in|tk|cc|tv|to|sh|shop|store|club|live|tech|cloud|page|website|space|pro|vip|win|click|icu|fun|today|" +
  "support|help|email|chat|zip|mov|security|login|account|bank|news|blog|mobi|name|world|network|digital|services|online|work|life|one|best|lol|host|social|team|ws|su|ua|pw|ca|au|jp|it|nl|pl|ch|mx|ar|cl";
const SCHEME = /\b(h)tt(ps?):\/\//gi;
// Telegram opens tg:// links (bots, proxies) and mail clients mailto:, both outside the app's control.
const OTHER_SCHEME = /\b(tg|mailto):/gi;
const WWW = /\b(www)\.(?=[a-z0-9-])/gi;
// A host followed by a path, or a host on a TLD clients link on its own (evil.example/login, evil.com).
// It only starts where a host can start (not inside one), so a long run of "a.a.a" stays linear.
const HOST = /(?<![a-z0-9-]|[a-z0-9-]\.)((?:[a-z0-9-]{1,63}\.)+)([a-z][a-z0-9-]{1,62})(?![a-z0-9-])/gi;
const LINKED_TLD = new RegExp(`^(?:${LINKED_TLDS})$`, "i");

/**
 * Text for channels outside the app (Telegram, e-mail), where clients make links of anything that
 * looks like an address, backticks or not: "http" becomes "hxxp", "tg:" and "mailto:" lose their colon,
 * "www." becomes "www[.]" and every dot of a host that a client would link becomes "[.]". Talorys' own links (the "Open Talorys"
 * button and e-mail footer) are added after this, so they stay clickable.
 */
export function unlinkForChannels(text: string): string {
  return text
    .replace(SCHEME, "$1xx$2://")
    .replace(OTHER_SCHEME, "$1[:]")
    .replace(WWW, "$1[.]")
    .replace(HOST, (match: string, labels: string, tld: string, offset: number, whole: string) =>
      whole[offset + match.length] === "/" || LINKED_TLD.test(tld) || whole.slice(Math.max(0, offset - 3), offset) === "://"
        ? `${labels.slice(0, -1).replaceAll(".", "[.]")}[.]${tld}`
        : match,
    );
}

/** Model- or outside-written text that no channel turns into a link: backticks in the app, defanged elsewhere. */
export function unlinked(text: string): string {
  return unlinkForChannels(defangLinks(text));
}
