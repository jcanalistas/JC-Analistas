import type { QueryDocumentSnapshot } from "@google-cloud/firestore";
import { firestore } from "./firestore";

export type BetSection = "recomendacion" | "combinada" | "mismo_partido";
export type BetStatus = "pendiente" | "ganada" | "perdida";

export interface BetCandidate {
  matchup: string;
  tournament: string;
  market: string;
  section: BetSection;
  sourceLabel: string;
}

export interface Bet extends BetCandidate {
  id: string;
  status: BetStatus;
  createdAt: number;
  resolvedAt?: number;
  realOdds?: number;
  profit?: number;
}

const COLLECTION = "bets";
// Candidatos a apuesta a la espera de que el usuario pulse "📝 Registrar
// apuesta" en su mensaje de Telegram. Antes vivían en un Map en memoria del
// proceso, y Cloud Run recicla el contenedor por inactividad mucho antes de
// lo que tarda un usuario en volver a mirar el móvil — se perdía el botón
// sin avisar. Guardarlos en Firestore (doc ID = el mismo token del botón)
// hace que sobrevivan a cualquier reinicio del contenedor.
const CANDIDATES_COLLECTION = "betCandidates";
// Stake fijo de referencia para calcular el beneficio, igual que en el
// mensaje-resumen del montaje de /ticket.
const STAKE_EUR = 50;

export async function createBetCandidate(token: string, candidate: BetCandidate): Promise<void> {
  await firestore
    .collection(CANDIDATES_COLLECTION)
    .doc(token)
    .set({ ...candidate, createdAt: Date.now() });
}

/** Lee el candidato y lo borra en el mismo paso (un botón solo se puede usar una vez). Null si ya se usó, caducó o nunca existió. */
export async function consumeBetCandidate(token: string): Promise<BetCandidate | null> {
  const ref = firestore.collection(CANDIDATES_COLLECTION).doc(token);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;

  await ref.delete();
  const { matchup, tournament, market, section, sourceLabel } = snapshot.data() as BetCandidate;
  return { matchup, tournament, market, section, sourceLabel };
}

export async function createPendingBet(candidate: BetCandidate): Promise<string> {
  const doc = await firestore.collection(COLLECTION).add({
    ...candidate,
    status: "pendiente" satisfies BetStatus,
    createdAt: Date.now(),
  });
  return doc.id;
}

export async function getPendingBets(): Promise<Bet[]> {
  const snapshot = await firestore.collection(COLLECTION).where("status", "==", "pendiente").get();
  return snapshot.docs.map(toBet).sort((a, b) => b.createdAt - a.createdAt);
}

export async function markBetLost(id: string): Promise<void> {
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "perdida" satisfies BetStatus, resolvedAt: Date.now(), profit: -STAKE_EUR });
}

/** Marca la apuesta como ganada con la cuota REAL obtenida (no la estimada por el informe) y devuelve el beneficio calculado. */
export async function markBetWon(id: string, realOdds: number): Promise<number> {
  const profit = cleanFloat(STAKE_EUR * (realOdds - 1));
  await firestore
    .collection(COLLECTION)
    .doc(id)
    .update({ status: "ganada" satisfies BetStatus, resolvedAt: Date.now(), realOdds, profit });
  return profit;
}

export interface StatsSummary {
  total: number;
  pending: number;
  won: number;
  lost: number;
  hitRate: number; // % sobre las resueltas (ganadas + perdidas)
  netProfit: number;
}

export async function getStatsSummary(): Promise<StatsSummary> {
  const snapshot = await firestore.collection(COLLECTION).get();
  const bets = snapshot.docs.map(toBet);

  const pending = bets.filter((b) => b.status === "pendiente").length;
  const won = bets.filter((b) => b.status === "ganada").length;
  const lost = bets.filter((b) => b.status === "perdida").length;
  const resolved = won + lost;
  const netProfit = cleanFloat(bets.reduce((sum, b) => sum + (b.profit ?? 0), 0));
  const hitRate = resolved > 0 ? cleanFloat((won / resolved) * 100) : 0;

  return { total: bets.length, pending, won, lost, hitRate, netProfit };
}

function toBet(doc: QueryDocumentSnapshot): Bet {
  return { id: doc.id, ...doc.data() } as Bet;
}

/** Corrige el ruido de coma flotante antes de redondear (ver formatTicketCaption.ts). */
function cleanFloat(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** "45.5" -> "45,5", "46" -> "46" — sin ceros de más, coma decimal. */
export function formatMoney(n: number): string {
  const fixed = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return fixed.replace(".", ",");
}
