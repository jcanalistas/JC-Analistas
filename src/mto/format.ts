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

export function formatAlert(event: MtoEvent, p: PatternResult): string {
  const lines = [`⚠️ <b>${escapeHtml(event.player)}</b> — patrón de asistencias médicas`, ""];

  if (p.sameTournament.length >= 2) {
    lines.push(`🔁 ${p.sameTournament.length}ª asistencia en <b>${escapeHtml(event.tournament)}</b>`);
  }
  if (p.weekStreak.length >= 2) {
    lines.push(`📅 ${p.weekStreak.length} semanas seguidas con asistencia (${p.weekStreak.join(", ")})`);
  }
  if (p.recent.length >= 3) {
    lines.push(`📈 ${p.recent.length} asistencias en los últimos 30 días`);
  }
  if (p.early) lines.push(`⏱ Aviso temprano: minuto ${event.playedMinutes}`);
  if (p.opponentAlsoTreated) lines.push("🚑 El rival también ha recibido asistencia en este partido");

  lines.push("", "<b>Ahora:</b>", eventLine(event), "", "<b>Historial reciente:</b>");
  const previous = p.recent.filter((e) => e.id !== event.id).slice(-6);
  lines.push(...(previous.length ? previous.map(eventLine) : ["• (ninguna en 30 días)"]));
  lines.push("", "👀 Vigilar su próximo partido (posible retirada o bajo rendimiento).");
  return lines.join("\n");
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
