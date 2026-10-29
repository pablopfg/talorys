import type { Language } from "./constants";
import type { ScheduleSpec } from "./recurrence";

/**
 * What a sentinel routine answers when nothing needs the owner. Compared after dropping case,
 * spaces, punctuation and Markdown, so "Nothing." and "**NOTHING**" count too.
 */
export const SENTINEL_NOTHING = "NOTHING";

/** A ready-made AI routine the owner can start from in Automations, in each app language. */
export interface SentinelTemplate {
  id: "morning" | "weekly" | "briefing" | "closing" | "saturday";
  schedule: ScheduleSpec;
  /** Stays quiet when nothing needs the owner. Defaults to true. */
  sentinel?: boolean;
  /** Meant to run only on days with events on a calendar the owner picks (for example, patients on a Saturday). */
  calendarGate?: boolean;
  /** English is the fallback for languages without their own text. */
  text: { en: SentinelText } & Partial<Record<Language, SentinelText>>;
}

interface SentinelText {
  name: string;
  prompt: string;
}

/** A template's name and prompt in `language`, or in English. */
export function sentinelText(template: SentinelTemplate, language: Language): SentinelText {
  return template.text[language] ?? template.text.en;
}

export const SENTINEL_TEMPLATES: readonly SentinelTemplate[] = [
  {
    id: "morning",
    schedule: { type: "daily", time: "07:00" },
    text: {
      en: {
        name: "Morning check",
        prompt:
          "Look at my open tasks, today's reminders and my recent notes. Tell me only what needs me today: what is due or overdue, what is blocked, and anything I should prepare. Keep it to a short list.",
      },
      "pt-BR": {
        name: "Checagem da manhã",
        prompt:
          "Olhe minhas tarefas abertas, os lembretes de hoje e minhas notas recentes. Me diga só o que precisa de mim hoje: o que vence ou está atrasado, o que está travado e o que devo preparar. Responda numa lista curta.",
      },
    },
  },
  {
    id: "weekly",
    schedule: { type: "weekly", days: [5], time: "17:00" },
    text: {
      en: {
        name: "Weekly review",
        prompt:
          "Review my week: open tasks with no progress, tasks overdue, and anything due next week that needs preparing now. Tell me only what needs a decision or an action from me, in a short list.",
      },
      "pt-BR": {
        name: "Revisão da semana",
        prompt:
          "Revise a minha semana: tarefas abertas sem andamento, tarefas atrasadas e o que vence na semana que vem e precisa de preparo agora. Me diga só o que pede uma decisão ou uma ação minha, numa lista curta.",
      },
    },
  },
  {
    id: "briefing",
    schedule: { type: "daily", time: "07:00" },
    sentinel: false,
    text: {
      en: {
        name: "Morning briefing",
        prompt:
          "Prepare my briefing for today: today's events on my calendars (first one and gaps), tasks due today or overdue, today's reminders, and what I should prepare before the first commitment. Short, in bullet points.",
      },
      "pt-BR": {
        name: "Briefing da manhã",
        prompt:
          "Prepare o meu briefing de hoje: os compromissos de hoje nas minhas agendas (o primeiro e os intervalos), as tarefas que vencem hoje ou estão atrasadas, os lembretes de hoje e o que devo preparar antes do primeiro compromisso. Curto, em tópicos.",
      },
    },
  },
  {
    id: "closing",
    schedule: { type: "weekly", days: [1, 2, 3, 4, 5], time: "19:00" },
    sentinel: false,
    text: {
      en: {
        name: "Closing the day",
        prompt:
          "Close my day: what was on my calendars today, tasks I finished, what is still open or overdue, and what I should leave ready for tomorrow (tomorrow's first event included). Short, in bullet points.",
      },
      "pt-BR": {
        name: "Fechamento do dia",
        prompt:
          "Faça o fechamento do meu dia: o que estava nas minhas agendas hoje, as tarefas que concluí, o que continua aberto ou atrasado e o que devo deixar pronto para amanhã (incluindo o primeiro compromisso de amanhã). Curto, em tópicos.",
      },
    },
  },
  {
    id: "saturday",
    schedule: { type: "weekly", days: [6], time: "13:00" },
    sentinel: false,
    calendarGate: true,
    text: {
      en: {
        name: "Saturday closing",
        prompt:
          "Close my Saturday: what was on my calendars today, what is still open or overdue, and what I should prepare for Monday. Short, in bullet points.",
      },
      "pt-BR": {
        name: "Fechamento de sábado",
        prompt:
          "Faça o fechamento do meu sábado: o que estava nas minhas agendas hoje, o que continua aberto ou atrasado e o que devo preparar para segunda-feira. Curto, em tópicos.",
      },
    },
  },
];

/** True when a sentinel's reply means "nothing needs the owner" (or it said nothing at all). */
export function isSentinelNothing(reply: string): boolean {
  const bare = reply.replace(/[\s\p{P}\p{S}]+/gu, "").toUpperCase();
  return bare === "" || bare === SENTINEL_NOTHING || bare === "NADA";
}
