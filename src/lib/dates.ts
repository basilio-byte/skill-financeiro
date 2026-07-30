import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  format,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";

/**
 * Datas e períodos com fuso de referência (Natal/RN = America/Fortaleza, UTC-3).
 * Regra: `dataCredito` (e as demais datas financeiras) são `@db.Date` (data pura,
 * sem fuso) — os limites de período são convertidos para "meia-noite UTC" do
 * dia-calendário antes de entrar em queries.
 */
export const APP_TZ = process.env.APP_TIMEZONE || "America/Fortaleza";

export type PeriodKind = "day" | "week" | "month" | "quarter" | "semester" | "year";

export const PERIOD_KINDS: Array<{ value: PeriodKind; label: string }> = [
  { value: "day", label: "Diário" },
  { value: "week", label: "Semanal" },
  { value: "month", label: "Mensal" },
  { value: "quarter", label: "Trimestral" },
  { value: "semester", label: "Semestral" },
  { value: "year", label: "Anual" },
];

export interface PeriodBounds {
  kind: PeriodKind;
  /** 'yyyy-MM-dd' inclusivo (primeiro dia do período) — também usado como chave do bucket. */
  fromKey: string;
  /** 'yyyy-MM-dd' inclusivo (último dia do período). */
  toKey: string;
  /** Date UTC-midnight do primeiro dia (uso em queries: gte). */
  fromDate: Date;
  /** Date UTC-midnight do dia SEGUINTE ao último (uso em queries: lt, exclusivo). */
  toDateExclusive: Date;
  /** Rótulo legível em pt-BR. */
  label: string;
}

/** Data/hora "agora" já convertida para o fuso do app. */
export function nowInAppTz(): Date {
  return toZonedTime(new Date(), APP_TZ);
}

/** 'yyyy-MM-dd' de uma data-calendário no fuso do app. */
export function dateKey(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Hoje ('yyyy-MM-dd') no fuso do app. */
export function todayKey(): string {
  return dateKey(nowInAppTz());
}

/** Converte 'yyyy-MM-dd' para Date em meia-noite UTC (para comparar com colunas @db.Date). */
export function keyToUtcDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

const WEEK_STARTS_ON = 1 as const;

/**
 * Interpreta 'yyyy-MM-dd' como DATA-CALENDÁRIO (relógio de parede), sem passar
 * por UTC — evita o bug de deslizar um dia ao tratar a string como instante UTC.
 */
function parseCalendarKey(key: string): Date {
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  return new Date(y, m - 1, d);
}

function startOfSemester(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() < 6 ? 0 : 6, 1);
}

function addSemesters(d: Date, amount: number): Date {
  return addMonths(d, amount * 6);
}

/**
 * Calcula os limites de um período (semana/mês/trimestre/semestre/ano) a partir
 * de uma data de referência (default: hoje no fuso do app).
 */
export function getPeriodBounds(kind: PeriodKind, reference?: Date | string): PeriodBounds {
  const refZoned =
    reference === undefined
      ? nowInAppTz()
      : typeof reference === "string"
        ? parseCalendarKey(reference)
        : toZonedTime(reference, APP_TZ);

  let start: Date;
  let nextStart: Date;
  switch (kind) {
    case "day":
      start = startOfDay(refZoned);
      nextStart = addDays(start, 1);
      break;
    case "week":
      start = startOfWeek(refZoned, { weekStartsOn: WEEK_STARTS_ON });
      nextStart = addWeeks(start, 1);
      break;
    case "month":
      start = startOfMonth(refZoned);
      nextStart = addMonths(start, 1);
      break;
    case "quarter":
      start = startOfQuarter(refZoned);
      nextStart = addQuarters(start, 1);
      break;
    case "semester":
      start = startOfSemester(refZoned);
      nextStart = addSemesters(start, 1);
      break;
    case "year":
      start = startOfYear(refZoned);
      nextStart = addYears(start, 1);
      break;
  }

  const fromKey = format(start, "yyyy-MM-dd");
  const lastDay = addDays(nextStart, -1);
  const toKey = format(lastDay, "yyyy-MM-dd");

  return {
    kind,
    fromKey,
    toKey,
    fromDate: keyToUtcDate(fromKey),
    toDateExclusive: keyToUtcDate(format(nextStart, "yyyy-MM-dd")),
    label: formatPeriodLabel(kind, start, lastDay),
  };
}

function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1;
}

function formatPeriodLabel(kind: PeriodKind, start: Date, end: Date): string {
  switch (kind) {
    case "day":
      return start.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
    case "week":
      return `${start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} – ${end.toLocaleDateString(
        "pt-BR",
        { day: "2-digit", month: "2-digit", year: "numeric" },
      )}`;
    case "month":
      return start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    case "quarter":
      return `${quarterOf(start)}º trimestre de ${start.getFullYear()}`;
    case "semester":
      return `${start.getMonth() < 6 ? "1º" : "2º"} semestre de ${start.getFullYear()}`;
    case "year":
      return start.getFullYear().toString();
  }
}

/**
 * Rótulo de período com inicial maiúscula, para quando ele aparece como TÍTULO
 * e não dentro de uma frase: "julho de 2026" → "Julho de 2026",
 * "3º trimestre de 2026" → "3º Trimestre de 2026".
 *
 * Não use CSS para isso. `capitalize` do Tailwind é text-transform:capitalize,
 * que maiúscula CADA palavra ("Julho De 2026"). `first-letter:uppercase` age no
 * primeiro CARACTERE, que no rótulo trimestral é o dígito "3" — o trimestre
 * ficaria todo minúsculo enquanto o mês virava maiúsculo.
 *
 * Também não serve procurar `\p{L}`: "º" (U+00BA, ordinal masculino) É uma letra
 * Unicode (categoria Lo) e não tem forma maiúscula, então a busca pararia nele e
 * devolveria a string intacta.
 *
 * A condição é "primeiro caractere que TEM CAIXA" (`toLowerCase !== toUpperCase`),
 * e não "primeiro caractere que muda ao virar maiúsculo": este segundo critério
 * acha a primeira MINÚSCULA, então "Julho de 2026" viraria "JUlho de 2026" (um
 * teste de idempotência pegou isso). Dígitos, "/", "–" e "º" são pulados
 * naturalmente; rótulo sem letra nenhuma ("2026") volta intacto.
 *
 * Limitação conhecida: serve para os rótulos de mês/trimestre/semestre/ano, os
 * únicos que aparecem como título hoje. No formato de DIA ("30 de julho de
 * 2026") o primeiro caractere com caixa é o "d" de "de", resultando em "30 De
 * julho de 2026" — se um dia um título usar dia ou semana, trate o caso lá.
 */
export function comInicialMaiuscula(label: string): string {
  const chars = [...label];
  const i = chars.findIndex((c) => c.toLowerCase() !== c.toUpperCase());
  if (i === -1) return label;
  chars[i] = chars[i]!.toUpperCase();
  return chars.join("");
}

/** Desloca uma chave 'yyyy-MM-dd' em `amount` períodos de `kind` (±1 para navegação). */
export function shiftPeriodKey(fromKey: string, kind: PeriodKind, amount: number): string {
  const base = parseCalendarKey(fromKey);
  let shifted: Date;
  switch (kind) {
    case "day":
      shifted = addDays(base, amount);
      break;
    case "week":
      shifted = addWeeks(base, amount);
      break;
    case "month":
      shifted = addMonths(base, amount);
      break;
    case "quarter":
      shifted = addQuarters(base, amount);
      break;
    case "semester":
      shifted = addSemesters(base, amount);
      break;
    case "year":
      shifted = addYears(base, amount);
      break;
  }
  return format(shifted, "yyyy-MM-dd");
}
