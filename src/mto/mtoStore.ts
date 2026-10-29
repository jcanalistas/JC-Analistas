import { firestore } from "../stats/firestore";
import { tennisCategory } from "./parseMto";
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

/**
 * Guarda los avisos que no existían todavía y devuelve esos. Se hace en
 * bloques (una lectura y una escritura por cada 300) porque guardarlos de
 * uno en uno con miles de avisos se pasaba del tiempo de la petición.
 */
export async function createEvents(events: MtoEvent[]): Promise<MtoEvent[]> {
  const created: MtoEvent[] = [];
  for (let i = 0; i < events.length; i += 300) {
    const chunk = events.slice(i, i + 300);
    const refs = chunk.map((e) => firestore.collection(EVENTS).doc(e.id));
    const snaps = await firestore.getAll(...refs);
    const batch = firestore.batch();
    chunk.forEach((event, j) => {
      if (snaps[j].exists) return;
      batch.set(refs[j], event);
      created.push(event);
    });
    await batch.commit();
  }
  return created;
}

// Se guardan todos los avisos, pero las consultas solo devuelven los que
// entran en el análisis: ATP y Challenger individual masculino.
function analyzed(docs: FirebaseFirestore.QueryDocumentSnapshot[]): MtoEvent[] {
  return docs.map((d) => d.data() as MtoEvent).filter((e) => tennisCategory(e) !== null);
}

export async function getPlayerEvents(playerKey: string): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("playerKey", "==", playerKey).get();
  return analyzed(snap.docs);
}

export async function getEventsSince(timestamp: number): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("timestamp", ">=", timestamp).get();
  return analyzed(snap.docs);
}

/** Todos los avisos desde una fecha, sin filtrar (para ver qué descarta el filtro). */
export async function getAllEventsSince(timestamp: number): Promise<MtoEvent[]> {
  const snap = await firestore.collection(EVENTS).where("timestamp", ">=", timestamp).get();
  return snap.docs.map((d) => d.data() as MtoEvent);
}
