import { firestore } from "../stats/firestore";
import type { MtoEvent } from "./patterns";

// Un documento por aviso del canal; el ID es el message_id de Telegram,
// así volver a leer el mismo mensaje nunca lo duplica.
const EVENTS = "mtoEvents";
// Estado del lector: último mensaje procesado, canal elegido y la sesión de
// tu cuenta de Telegram (equivale a tener la sesión iniciada: no compartir).
const STATE = "mtoState";

export interface MtoCursor {
  channelId?: string;
  channelTitle?: string;
  lastMessageId: number;
}

export async function getCursor(): Promise<MtoCursor> {
  const snap = await firestore.collection(STATE).doc("cursor").get();
  return (snap.data() as MtoCursor | undefined) ?? { lastMessageId: 0 };
}

export async function saveCursor(cursor: MtoCursor): Promise<void> {
  await firestore.collection(STATE).doc("cursor").set(cursor, { merge: true });
}

export async function getUserSession(): Promise<string | null> {
  const snap = await firestore.collection(STATE).doc("session").get();
  return (snap.data()?.session as string | undefined) ?? null;
}

export async function saveUserSession(session: string): Promise<void> {
  await firestore.collection(STATE).doc("session").set({ session, savedAt: Date.now() });
}

export interface PendingLogin {
  phone: string;
  phoneCodeHash: string;
  session: string;
}

export async function savePendingLogin(login: PendingLogin): Promise<void> {
  await firestore.collection(STATE).doc("login").set(login);
}

export async function getPendingLogin(): Promise<PendingLogin | null> {
  const snap = await firestore.collection(STATE).doc("login").get();
  return (snap.data() as PendingLogin | undefined) ?? null;
}

export async function clearPendingLogin(): Promise<void> {
  await firestore.collection(STATE).doc("login").delete();
}

/** Guarda el aviso. Devuelve false si ya existía (otra ejecución lo procesó antes). */
export async function createEvent(event: MtoEvent): Promise<boolean> {
  try {
    await firestore.collection(EVENTS).doc(event.id).create(event);
    return true;
  } catch (err) {
    // 6 = ALREADY_EXISTS
    if ((err as { code?: number }).code === 6) return false;
    throw err;
  }
}

export async function getPlayerEvents(playerKey: string): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("playerKey", "==", playerKey).get();
  return snap.docs.map((d) => d.data() as MtoEvent);
}

export async function getTournamentEvents(tournamentKey: string): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("tournamentKey", "==", tournamentKey).get();
  return snap.docs.map((d) => d.data() as MtoEvent);
}

export async function getEventsSince(timestamp: number): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("timestamp", ">=", timestamp).get();
  return snap.docs.map((d) => d.data() as MtoEvent);
}
