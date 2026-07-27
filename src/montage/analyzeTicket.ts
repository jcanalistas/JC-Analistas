import { GoogleGenAI } from "@google/genai";

export type Sport = "tenis" | "futbol";

export interface TicketInfo {
  sport: Sport;
  competition: string;
  selections: string;
}

const ANALYSIS_MODEL = "gemini-flash-latest";

const ANALYZE_PROMPT = `Analiza esta imagen de un ticket de apuesta deportiva (tenis o fútbol).
Devuelve tu respuesta EXACTAMENTE en este formato, una línea por campo, sin nada más:
DEPORTE: tenis
COMPETICION: <nombre de la competición o torneo tal como aparece en el ticket>
SELECCIONES: <resumen breve combinando apellidos de jugadores o equipos y el mercado de cada selección, unidos por " + ", por ejemplo "Poljicak + Dalla Valle Set">

DEPORTE debe ser exactamente "tenis" o "futbol", según corresponda.`;

/** Usa la visión de Gemini para leer el ticket y extraer deporte, competición y selecciones. */
export async function analyzeTicket(ticketBuffer: Buffer, apiKey: string): Promise<TicketInfo> {
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: ANALYSIS_MODEL,
    contents: [
      { text: ANALYZE_PROMPT },
      { inlineData: { mimeType: "image/png", data: ticketBuffer.toString("base64") } },
    ],
  });

  return parseTicketInfo(response.text ?? "");
}

function parseTicketInfo(text: string): TicketInfo {
  const sportMatch = /DEPORTE:\s*(tenis|f[uú]tbol)/i.exec(text);
  const competitionMatch = /COMPETICION:\s*(.+)/i.exec(text);
  const selectionsMatch = /SELECCIONES:\s*(.+)/i.exec(text);

  const sport: Sport = /tenis/i.test(sportMatch?.[1] ?? "") ? "tenis" : "futbol";
  const competition = competitionMatch?.[1]?.trim() ?? "";
  const selections = selectionsMatch?.[1]?.trim() ?? "";

  if (!competition || !selections) {
    throw new Error(`No se pudo extraer la información del ticket. Respuesta recibida: ${text.slice(0, 200)}`);
  }

  return { sport, competition, selections };
}
