/**
 * Password rules (NIST SP 800-63B, OWASP ASVS): length matters, composition rules don't. A new
 * password needs 15 characters, any characters, pasting allowed, up to 256. Breached passwords are
 * refused separately (isBreachedPassword), where the network allows it.
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 256;
/** The previous rule. A password already set (OWNER_PASSWORD) that meets only this one still works. */
export const LEGACY_PASSWORD_MIN_LENGTH = 10;

/** Length as a person counts it: each Unicode code point is one character. */
function length(password: string): number {
  return [...password].length;
}

/**
 * Words and runs everyone tries first (breach top lists, English and Portuguese). Matched after
 * undoing common substitutions (p@ssw0rd), anywhere in the password.
 */
const PREDICTABLE = [
  "password", "passwd", "senha", "talorys", "qwerty", "asdfgh", "zxcvbn", "qwertz", "azerty", "letmein", "iloveyou",
  "teamo", "admin", "welcome", "bemvindo", "monkey", "dragon", "master", "sunshine", "princess", "football", "futebol",
  "flamengo", "corinthians", "palmeiras", "brasil", "brazil", "mudar", "trocar", "teste", "abc123", "secret", "segredo",
];
const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };
const KEYBOARD_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm", "abcdefghijklmnopqrstuvwxyz"];

/** Marks what was taken out, so the pieces around it don't join into a new word. Never counted. */
const GONE = "\u0000";

/** Takes every occurrence of `word` (4+ characters) out of `text`. */
function strip(text: string, word: string): string {
  return word.length >= 4 ? text.split(word).join(GONE) : text;
}

/** Takes out ascending or descending runs of 4+ along the alphabet, the digits or a keyboard row. */
function stripRuns(text: string): string {
  let out = text;
  for (const row of KEYBOARD_ROWS) {
    for (const line of [row, [...row].reverse().join("")]) {
      for (let len = line.length; len >= 4; len--) {
        for (let i = 0; i + len <= line.length; i++) out = strip(out, line.slice(i, i + len));
      }
    }
  }
  return out;
}

/** The shortest unit the password repeats ("abcabcabc" → "abc"), or the password itself. */
function repeatedUnit(text: string): string {
  const chars = [...text];
  for (let size = 1; size <= chars.length / 2; size++) {
    if (chars.length % size !== 0) continue;
    const unit = chars.slice(0, size).join("");
    if (unit.repeat(chars.length / size) === text) return unit;
  }
  return text;
}

/**
 * How many characters are left once the guessable parts are taken out: words from the lists above,
 * runs like "1234" or "qwerty", repetition, and the owner's own details (e-mail, agent name).
 */
function unpredictableLength(password: string, context: readonly string[]): number {
  const personal = context.flatMap((c) => c.normalize("NFKC").toLowerCase().split(/[^\p{L}\p{N}]+/u));
  // Runs first: undoing substitutions would turn "12345" into "i2eas".
  let text = stripRuns(repeatedUnit(password.normalize("NFKC").toLowerCase()));
  for (const word of personal) text = strip(text, word);
  text = [...text].map((c) => LEET[c] ?? c).join("");
  for (const word of [...PREDICTABLE, ...personal]) text = strip(text, word);
  text = text.replace(/(.)\1{2,}/gsu, "$1");
  return length(text.split(GONE).join(""));
}

/**
 * Returns a human-readable problem with a new password, or null when acceptable. Guessable parts
 * (common words, runs such as "1234", repetition, the owner's own e-mail or agent name) don't count
 * toward the minimum, so "Senha@123456789" is refused however long it is. Breached passwords are
 * refused separately.
 */
export function checkPasswordStrength(password: string, context: readonly string[] = []): string | null {
  if (length(password) < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (length(password) > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (isRepeatedGrapheme(password)) return "Avoid repeating a single character.";
  if (unpredictableLength(password, context) < PASSWORD_MIN_LENGTH) {
    return "Too predictable: common words, sequences like 1234 and your own details don't count. Add more unrelated words.";
  }
  return null;
}

/** Whether a password set before the current rule may still be used to sign in. */
export function meetsLegacyPolicy(password: string): boolean {
  const n = length(password);
  return n >= LEGACY_PASSWORD_MIN_LENGTH && n <= PASSWORD_MAX_LENGTH && !isRepeatedGrapheme(password);
}

function isRepeatedGrapheme(password: string): boolean {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter();
    const graphemes = Array.from(segmenter.segment(password), (s) => s.segment);
    return graphemes.length > 0 && graphemes.every((g) => g === graphemes[0]);
  }
  return /^(.)\1+$/su.test(password);
}

export const BREACH_API = "https://api.pwnedpasswords.com/range/";
const BREACH_TIMEOUT_MS = 5_000;

/**
 * Asks Have I Been Pwned whether the password appeared in a known breach, with k-anonymity: only
 * the first 5 hex characters of its SHA-1 leave this machine, and padded answers hide which
 * suffix was looked at. True: breached; false: not found; null: the service could not answer
 * (the caller decides; a new password is then accepted on length alone).
 */
export async function isBreachedPassword(password: string, fetcher: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(password.normalize("NFKC")));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    const res = await fetcher(`${BREACH_API}${hex.slice(0, 5)}`, {
      headers: { "add-padding": "true", "user-agent": "talorys-breach-check" },
      signal: AbortSignal.timeout(BREACH_TIMEOUT_MS),
      redirect: "error",
    });
    if (!res.ok) return null;
    const suffix = hex.slice(5);
    for (const line of (await res.text()).split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    return null;
  }
}
