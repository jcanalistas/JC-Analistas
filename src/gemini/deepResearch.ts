import { GoogleGenAI } from "@google/genai";
import { withRetry } from "./retry";

export class DeepResearchError extends Error {
  constructor(message: string, public readonly promptPreview: string) {
    super(message);
    this.name = "DeepResearchError";
  }
}

interface CreateOptions {
  apiKey: string;
  /** p.ej. "deep-research-preview-04-2026" o "deep-research-max-preview-04-2026" */
  agent: string;
}

// El SDK aplica por defecto un timeout de 90s a cada petición HTTP, muy
// corto para crear un Deep Research (que puede tardar en confirmar el
// arranque). Lo subimos igualmente, aunque el timeout real que nos
// protege es el nuestro propio (ver withTimeout): se ha observado que
// algunos rechazos internos del SDK quedan "huérfanos" (no propagan al
// await que nosotros hacemos), dejando la petición colgada para siempre
// sin error ni resultado. withTimeout garantiza que SIEMPRE avancemos.
const HTTP_TIMEOUT_MS = 5 * 60_000;
const CREATE_TIMEOUT_MS = 2 * 60_000;
const POLL_TIMEOUT_MS = 60_000;
const CREATE_RETRIES = 3;
const CREATE_RETRY_BASE_DELAY_MS = 3_000;

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey, httpOptions: { timeout: HTTP_TIMEOUT_MS } });
}

/**
 * Lanza un Deep Research en segundo plano en los servidores de Google y
 * devuelve solo su ID (tarda segundos). NO espera a que termine — eso lo
 * hace `pollDeepResearchOnce`, pensada para llamarse repetidamente desde
 * fuera (ver /internal/poll-research en server.ts) en vez de mantener un
 * proceso esperando de forma continua los 20-30 minutos que puede tardar
 * en completarse: un contenedor de Cloud Run puede reciclarse por el
 * camino y perder ese progreso sin avisar.
 */
export async function createDeepResearchInteraction(prompt: string, options: CreateOptions): Promise<string> {
  try {
    // Lanzar los 3 Deep Research casi a la vez puede toparse con un 429
    // transitorio de la API; unos segundos de espera y reintento suelen
    // bastar (a diferencia de un 429 por cuota diaria agotada, que seguirá
    // fallando igual tras el reintento, pero no cuesta nada intentarlo).
    const interaction = await withRetry(
      () =>
        withTimeout(
          client(options.apiKey).interactions.create({
            input: prompt,
            agent: options.agent,
            background: true,
          }),
          CREATE_TIMEOUT_MS,
          "Tiempo de espera agotado creando la interacción"
        ),
      { retries: CREATE_RETRIES, baseDelayMs: CREATE_RETRY_BASE_DELAY_MS }
    );
    return interaction.id;
  } catch (err) {
    console.error("No se pudo crear la interacción de Deep Research:", err);
    throw new DeepResearchError(
      `No se pudo iniciar el Deep Research en la API de Gemini: ${describeError(err)}`,
      prompt
    );
  }
}

export type PollOutcome =
  | { status: "running" }
  | { status: "completed"; reportText: string }
  | { status: "failed"; message: string };

/**
 * Consulta UNA VEZ el estado de una interacción ya creada (sin bucle ni
 * espera interna) — pensado para llamarse repetidamente desde un sondeo
 * externo (Cloud Scheduler cada 1-2 min) en vez de mantener un proceso
 * esperando de forma continua. Un fallo de red puntual se trata como
 * "sigue corriendo" (se reintentará en el próximo sondeo); quien llama es
 * responsable de comparar contra su propio plazo límite y darlo por
 * fallido si se pasa de tiempo.
 */
export async function pollDeepResearchOnce(interactionId: string, options: { apiKey: string }): Promise<PollOutcome> {
  let result;
  try {
    result = await withTimeout(
      client(options.apiKey).interactions.get(interactionId),
      POLL_TIMEOUT_MS,
      "Tiempo de espera agotado consultando el estado"
    );
  } catch (err) {
    console.error(`Fallo consultando interacción ${interactionId}, se reintentará en el próximo sondeo:`, err);
    return { status: "running" };
  }

  if (result.status === "completed") {
    const reportText = extractReportText(result);
    if (!reportText.trim()) {
      return { status: "failed", message: "Gemini terminó pero no devolvió texto en el informe." };
    }
    return { status: "completed", reportText };
  }

  if (result.status === "failed" || result.status === "cancelled" || result.status === "budget_exceeded") {
    return { status: "failed", message: `El Deep Research terminó con estado "${result.status}" en la API de Gemini.` };
  }

  return { status: "running" };
}

/**
 * Fuerza que una promesa se resuelva o rechace en un plazo máximo,
 * independientemente de lo que haga internamente. Necesario porque se ha
 * observado que el SDK de Gemini puede dejar una petición colgada para
 * siempre (ni resuelve ni rechaza) tras un fallo interno, en vez de
 * propagar el error al propio await.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${message} (${ms / 1000}s)`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * `output_text` lo añade el SDK como el texto concatenado del último
 * output del modelo — es la forma más directa de sacar el informe. Si no
 * viene (versión distinta de la API), caemos al último "step" de tipo
 * model_output, tal como muestra el ejemplo oficial de la documentación.
 */
function extractReportText(interaction: { output_text?: string; steps?: unknown[] }): string {
  if (interaction.output_text) return interaction.output_text;

  const lastStep = interaction.steps?.at(-1) as
    | { type?: string; content?: Array<{ text?: string }> }
    | undefined;
  const text = lastStep?.content?.[0]?.text;
  return text ?? "";
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
