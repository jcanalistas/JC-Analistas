import type { QueryDocumentSnapshot } from "@google-cloud/firestore";
import { firestore } from "./firestore";
import type { DateFilter, Sport, TennisCategory } from "../config/prompts";

export type ResearchProfileStatus = "pending" | "completed" | "failed";

export interface ResearchJobProfile {
  label: string;
  /** Si falta, es que ni siquiera se pudo crear la interacción en Gemini (ver errorMessage). */
  interactionId?: string;
  status: ResearchProfileStatus;
  reportText?: string;
  errorMessage?: string;
  /** Si ya se le mandó al usuario el "✅ X completado" / "⚠️ ..." de este perfil en concreto. */
  notified: boolean;
}

export interface ResearchJob {
  id: string;
  chatId: number;
  sport: Sport;
  dateFilter?: DateFilter;
  tennisCategory?: TennisCategory;
  competitions?: string[];
  /** true si viene del /analizar de tenis automático de las 7:00, para el mensaje inicial. */
  scheduled: boolean;
  createdAt: number;
  /** Date.now() + timeoutMinutes*60000, calculado una sola vez al crear el job. */
  deadline: number;
  profiles: ResearchJobProfile[];
  /** Si ya se le mandaron al usuario los mensajes finales (Selecciones/Recomendaciones/Combinada). */
  resultsSent: boolean;
}

const COLLECTION = "researchJobs";

export async function createResearchJob(job: Omit<ResearchJob, "id">): Promise<string> {
  const doc = await firestore.collection(COLLECTION).add(job);
  return doc.id;
}

/** Jobs a los que aún les falta mandar los mensajes finales (con perfiles pendientes, o resueltos pero sin avisar). */
export async function getUnresolvedResearchJobs(): Promise<ResearchJob[]> {
  const snapshot = await firestore.collection(COLLECTION).where("resultsSent", "==", false).get();
  return snapshot.docs.map(toJob);
}

export async function hasUnresolvedResearchJob(): Promise<boolean> {
  const snapshot = await firestore.collection(COLLECTION).where("resultsSent", "==", false).limit(1).get();
  return !snapshot.empty;
}

export async function updateResearchJob(job: ResearchJob): Promise<void> {
  const { id, ...data } = job;
  await firestore.collection(COLLECTION).doc(id).set(data);
}

/** Cancela un job manualmente (p.ej. si se ha quedado colgado): lo borra sin más, no queda registro. */
export async function deleteResearchJob(id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).delete();
}

function toJob(doc: QueryDocumentSnapshot): ResearchJob {
  return { id: doc.id, ...doc.data() } as ResearchJob;
}
