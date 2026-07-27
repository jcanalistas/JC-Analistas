import { GoogleGenAI } from "@google/genai";
import { withRetry } from "../gemini/retry";

export type Sport = "tenis" | "futbol";

export interface TicketInfo {
  sport: Sport;
  competition: string;
  selections: string;
}

const ANALYSIS_MODEL = "gemini-flash-latest";

const ANALYZE_PROMPT = `Analiza esta imagen de un ticket de apuesta deportiva (tenis o fútbol) de Winamax. Puede tener una o varias selecciones (picks), todas de partidos dentro de las próximas 24h.

Para identificar la competición de cada selección, basándote solo en lo que ves en la imagen:
- La bandera pequeña junto a cada partido indica el PAÍS del torneo/liga (es la convención de Winamax), no la nacionalidad de los jugadores.
- Combina esa bandera con los nombres de jugadores/equipos, el nivel/contexto que se intuya del ticket (rondas, cuotas, nombres reconocibles de circuito ATP vs. jugadores de Challenger) y cualquier otro texto visible para deducir el torneo exacto, con el formato habitual: en tenis "ATP <ciudad>" o "CH <ciudad>" (Challenger), en fútbol el nombre de la liga o competición (ej. "LaLiga", "Premier League", "Champions League").
- Por defecto, si dos o más selecciones comparten la misma bandera de país y se juegan el mismo día, asume que son del MISMO torneo salvo que tengas una señal clara de que son de categorías distintas (p. ej. un jugador claramente top-100 ATP y otro claramente de nivel Challenger); ante la duda, prefiere un único torneo en vez de inventar dos.
- Si TODAS las selecciones del ticket son del mismo torneo/competición, escribe ese torneo una sola vez.
- Si hay selecciones de torneos/competiciones claramente distintos, escribe todos separados por " & ", por ejemplo "ATP Washington & CH Bonn".

Devuelve tu respuesta EXACTAMENTE en este formato, una línea por campo, sin nada más:
DEPORTE: tenis
COMPETICION: <torneo o torneos, según las reglas de arriba>
SELECCIONES: <resumen breve combinando apellidos de jugadores o equipos y el mercado de cada selección, unidos por " + ", por ejemplo "Poljicak + Dalla Valle Set">

DEPORTE debe ser exactamente "tenis" o "futbol", según corresponda.`;

const ANALYZE_TIMEOUT_MS = 90_000;
const ANALYZE_RETRIES = 2;
const ANALYZE_RETRY_BASE_DELAY_MS = 3_000;

/** Usa la visión de Gemini para leer el ticket y extraer deporte, competición y selecciones. */
export async function analyzeTicket(ticketBuffer: Buffer, apiKey: string): Promise<TicketInfo> {
  const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: ANALYZE_TIMEOUT_MS } });

  const response = await withRetry(
    () =>
      withTimeout(
        client.models.generateContent({
          model: ANALYSIS_MODEL,
          contents: [
            { text: ANALYZE_PROMPT },
            { inlineData: { mimeType: "image/png", data: ticketBuffer.toString("base64") } },
          ],
        }),
        ANALYZE_TIMEOUT_MS,
        "Tiempo de espera agotado analizando el ticket"
      ),
    { retries: ANALYZE_RETRIES, baseDelayMs: ANALYZE_RETRY_BASE_DELAY_MS }
  );

  return parseTicketInfo(response.text ?? "");
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (${ms / 1000}s)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function parseTicketInfo(text: string): TicketInfo {
  // La búsqueda de Google a veces hace que el modelo devuelva los campos
  // envueltos en markdown (**DEPORTE:** tenis) pese a pedir texto plano;
  // se quitan los símbolos de énfasis antes de parsear.
  const cleaned = text.replace(/[*_`#]/g, "");

  const sportMatch = /DEPORTE:\s*(tenis|f[uú]tbol)/i.exec(cleaned);
  const competitionMatch = /COMPETICION:\s*(.+)/i.exec(cleaned);
  const selectionsMatch = /SELECCIONES:\s*(.+)/i.exec(cleaned);

  const sport: Sport = /tenis/i.test(sportMatch?.[1] ?? "") ? "tenis" : "futbol";
  const competition = competitionMatch?.[1]?.trim() ?? "";
  const selections = selectionsMatch?.[1]?.trim() ?? "";

  if (!competition || !selections) {
    throw new Error(`No se pudo extraer la información del ticket. Respuesta recibida: ${text.slice(0, 300)}`);
  }

  return { sport, competition, selections };
}
