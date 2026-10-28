import { Fragment, type ReactNode, useSyncExternalStore } from "react";
import { DEFAULT_LANGUAGE, type Language, LANGUAGES, localizeServerText } from "@talorys/shared";
import { format, isLanguage, type MessageKey, type MessageParams, translate } from "./core";

export type { MessageKey, PlainMessageKey } from "./core";
export type LanguagePreference = "system" | Language;

/** Each language's name in that language, as shown in the language picker. */
export const LANGUAGE_NAMES: Record<Language, string> = { en: "English", ko: "한국어", "pt-BR": "Português (Brasil)" };

export interface I18n {
  /** What the owner picked in Settings. */
  preference: LanguagePreference;
  /** The language messages are shown in. */
  language: Language;
  /** BCP 47 locale for dates and numbers. With "system" it is the browser's, as before localization. */
  locale: string;
  t<K extends MessageKey>(key: K, ...params: MessageParams<K, string>): string;
  /** Like t, but parameters may be elements, for messages with links or code inside. */
  rich<K extends MessageKey>(key: K, ...params: MessageParams<K, ReactNode>): ReactNode;
  /** English text written by the server (errors, notifications, tool labels) in this language. */
  serverText(text: string): string;
}

const KEY = "talorys.language";

/** A language whose code has a region, matched by its base too ("pt" or "pt-PT" picks "pt-BR"). */
const REGIONAL: Partial<Record<string, Language>> = Object.fromEntries(
  LANGUAGES.filter((language) => language.includes("-")).map((language) => [language.split("-")[0]!.toLowerCase(), language]),
);

/** The first browser language we have messages for, else the default language. */
export function browserLanguage(): Language {
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const exact = LANGUAGES.find((language) => language.toLowerCase() === tag?.toLowerCase());
    if (exact) return exact;
    const base = tag?.toLowerCase().split("-")[0];
    if (isLanguage(base)) return base;
    const regional = base && REGIONAL[base];
    if (regional) return regional;
  }
  return DEFAULT_LANGUAGE;
}

function create(preference: LanguagePreference): I18n {
  const language = preference === "system" ? browserLanguage() : preference;
  const locale = preference === "system" ? new Intl.NumberFormat().resolvedOptions().locale : language;
  return {
    preference,
    language,
    locale,
    t: (key, ...params) => translate(language, locale, key, ...params),
    rich: (key, ...[params]) => format<ReactNode>(language, locale, key, params).map((part, i) => <Fragment key={i}>{part}</Fragment>),
    serverText: (text) => localizeServerText(text, language),
  };
}

let current: I18n | null = null;
const listeners = new Set<() => void>();
const onBrowserChange = () => applyLanguage("system");

export function applyLanguage(preference: LanguagePreference): void {
  try {
    localStorage.setItem(KEY, preference);
  } catch {
    /* storage unavailable */
  }
  if (current && current.preference === preference && preference !== "system") return;
  current = create(preference);
  // Absent when components are rendered to a string in tests.
  if (typeof window !== "undefined") {
    document.documentElement.lang = current.language;
    window.removeEventListener("languagechange", onBrowserChange);
    if (preference === "system") window.addEventListener("languagechange", onBrowserChange);
  }
  for (const listener of listeners) listener();
}

/** Applies the last known language before first render, so the sign-in screen is translated too. */
export function initLanguage(): void {
  let preference: LanguagePreference = DEFAULT_LANGUAGE;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "system" || isLanguage(stored)) preference = stored;
  } catch {
    /* ignore */
  }
  applyLanguage(preference);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): I18n {
  if (!current) initLanguage();
  return current!;
}

/** The active language outside React, for code that runs outside components (API errors, push setup). */
export function currentI18n(): I18n {
  return snapshot();
}

/** The active language, its message lookup and its formatting locale. Re-renders when the language changes. */
export function useI18n(): I18n {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
