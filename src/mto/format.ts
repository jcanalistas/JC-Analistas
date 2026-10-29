import { dedupe, sameEdition, type MtoEvent, type PatternResult } from "./patterns";

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("es-ES", {
    timeZone: "Europe/Madrid",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function eventLine(e: MtoEvent): string {
  const parts = [shortDate(e.timestamp), escapeHtml(e.tournament)];
  if (e.round) parts.push(escapeHtml(e.round));
  if (e.opponent) parts.push(`vs ${escapeHtml(e.opponent)}`);
  if (e.playedMinutes !== undefined) parts.push(`min ${e.playedMinutes}`);
  if (e.score) parts.push(escapeHtml(e.score));
  return `• ${parts.join(" · ")}`;
}

const BET_HINT =
  "👉 Si siguen vivos (ganan este partido o se apuntan al próximo torneo), apostar en su contra en su siguiente partido.";

function patternTags(p: PatternResult): string[] {
  const tags: string[] = [];
  if (p.sameTournament.length >= 2) tags.push(`🔁 ${p.sameTournament.length}ª en este torneo`);
  if (p.weekStreak.length >= 2) tags.push(`📅 ${p.weekStreak.length} semanas seguidas`);
  if (p.recent.length >= 3) tags.push(`📈 ${p.recent.length} en 30 días`);
  if (p.early) tags.push("⏱ antes del min 20");
  if (p.opponentAlsoTreated) tags.push("🚑 el rival también");
  return tags;
}

export interface DigestItem {
  event: MtoEvent;
  patterns: PatternResult;
}

/** Solo los jugadores que repiten asistencia, con sus asistencias anteriores. */
export function formatRepeaters(items: DigestItem[], days: number): string {
  const repeaters = items
    .filter((i) => i.patterns.alert)
    .sort((a, b) => b.patterns.recent.length - a.patterns.recent.length || b.event.timestamp - a.event.timestamp);
  if (!repeaters.length) {
    return `🔁 Nadie repite asistencia médica entre los atendidos en los últimos ${days} días.`;
  }

  const lines = [`🔁 <b>Repiten asistencia médica</b> — ${repeaters.length} jugadores (últimos ${days} días)`];
  for (const { event, patterns } of repeaters) {
    lines.push("", `⚠️ <b>${escapeHtml(event.player)}</b> — ${patternTags(patterns).join(" · ")}`, eventLine(event));
    const previous = patterns.recent.filter((e) => e.id !== event.id).slice(-3).reverse();
    lines.push(...previous.map((e) => `   ↳ ${eventLine(e).slice(2)}`));
  }
  lines.push("", BET_HINT, "Todos los atendidos: /mto_vigilar");
  return lines.join("\n");
}

/** Jugadores con asistencia en los últimos días, los de patrón primero: candidatos a apostar en contra. */
export function formatWatchlist(items: DigestItem[], days: number): string {
  if (!items.length) return `🚑 Nadie ha recibido asistencia médica en los últimos ${days} días.`;
  const sorted = [...items].sort(
    (a, b) => Number(b.patterns.alert) - Number(a.patterns.alert) || b.event.timestamp - a.event.timestamp
  );
  const lines = [`👀 <b>A vigilar</b> — asistencia médica en los últimos ${days} días`, ""];
  for (const { event, patterns } of sorted.slice(0, 40)) {
    const tags = patternTags(patterns);
    lines.push(`${patterns.alert ? "⚠️" : "•"} <b>${escapeHtml(event.player)}</b>${tags.length ? " — " + tags.join(" · ") : ""}`);
    lines.push(`   ${eventLine(event).slice(2)}`);
  }
  if (sorted.length > 40) lines.push(`… y ${sorted.length - 40} más`);
  lines.push("", BET_HINT);
  return lines.join("\n");
}

/** Telegram corta los mensajes a 4096 caracteres: se trocea por líneas. */
export function splitMessage(text: string, max = 4000): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > max) {
      chunks.push(current);
      current = "";
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function formatPlayerHistory(events: MtoEvent[]): string {
  const list = dedupe(events);
  const player = list[list.length - 1].player;
  const tournaments = new Set(list.map((e) => e.tournamentKey)).size;
  const lines = [
    `🚑 <b>${escapeHtml(player)}</b>`,
    `${list.length} asistencias médicas en ${tournaments} torneos`,
    "",
    ...list.slice(-20).map(eventLine),
  ];
  if (list.length > 20) lines.push(`… y ${list.length - 20} más antiguas`);
  return lines.join("\n");
}

export function formatRanking(events: MtoEvent[], now = Date.now()): string {
  const sections: string[] = [];
  for (const days of [7, 30]) {
    const since = now - days * 24 * 60 * 60 * 1000;
    const byPlayer = new Map<string, MtoEvent[]>();
    for (const e of dedupe(events.filter((e) => e.timestamp >= since))) {
      byPlayer.set(e.playerKey, [...(byPlayer.get(e.playerKey) ?? []), e]);
    }
    const ranked = [...byPlayer.values()]
      .filter((list) => list.length >= 2)
      .sort((a, b) => b.length - a.length || b[b.length - 1].timestamp - a[a.length - 1].timestamp)
      .slice(0, 15);

    const lines = [`<b>Últimos ${days} días</b> (2 o más asistencias)`];
    if (!ranked.length) lines.push("• Nadie");
    for (const list of ranked) {
      const repeated = list.some((a, i) => list.some((b, j) => i !== j && sameEdition(a, b))) ? " 🔁" : "";
      lines.push(`• ${escapeHtml(list[0].player)} — ${list.length}${repeated}`);
    }
    sections.push(lines.join("\n"));
  }
  return [
    "🚑 <b>Ranking de asistencias médicas</b>",
    "",
    sections.join("\n\n"),
    "",
    "🔁 = más de una en el mismo torneo. Detalle: /mto nombre",
  ].join("\n");
}
