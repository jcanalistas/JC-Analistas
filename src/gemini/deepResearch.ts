import { GoogleGenAI } from "@google/genai";

export interface DeepResearchResult {
  prompt: string;
  reportText: string;
}

export class DeepResearchError extends Error {
  constructor(message: string, public readonly promptPreview: string) {
    super(message);
    this.name = "DeepResearchError";
  }
}

interface RunOptions {
  apiKey: string;
  /** p.ej. "deep-research-preview-04-2026" o "deep-research-max-preview-04-2026" */
  agent: string;
  timeoutMinutes: number;
  pollIntervalMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

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

/**
 * Ejecuta un Deep Research usando la API oficial de Gemini (Interactions
 * API), sin navegador ni sesión de Google — solo una API key de Google AI
 * Studio. La tarea corre en segundo plano en los servidores de Google y
 * aquí hacemos polling hasta que termina.
 */
export async function runDeepResearch(prompt: string, options: RunOptions): Promise<DeepResearchResult> {
  const client = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: { timeout: HTTP_TIMEOUT_MS },
  });

  let interactionId: string;
  try {
    const interaction = await withTimeout(
      client.interactions.create({
        input: prompt,
        agent: options.agent,
        background: true,
      }),
      CREATE_TIMEOUT_MS,
      "Tiempo de espera agotado creando la interacción"
    );
    interactionId = interaction.id;
  } catch (err) {
    throw new DeepResearchError(
      `No se pudo iniciar el Deep Research en la API de Gemini: ${describeError(err)}`,
      prompt
    );
  }

  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + options.timeoutMinutes * 60_000;
  let consecutivePollErrors = 0;

  while (true) {
    if (Date.now() > deadline) {
      throw new DeepResearchError(
        `Gemini no terminó el informe en ${options.timeoutMinutes} minutos. ` +
          `Puedes subir DEEP_RESEARCH_TIMEOUT_MINUTES si tus investigaciones tardan más.`,
        prompt
      );
    }

    let result;
    try {
      result = await withTimeout(
        client.interactions.get(interactionId),
        POLL_TIMEOUT_MS,
        "Tiempo de espera agotado consultando el estado"
      );
      consecutivePollErrors = 0;
    } catch (err) {
      consecutivePollErrors++;
      if (consecutivePollErrors > MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new DeepResearchError(
          `Error consultando el estado del Deep Research (${consecutivePollErrors} intentos fallidos seguidos): ${describeError(err)}`,
          prompt
        );
      }
      // Fallo puntual (p.ej. un timeout huérfano del SDK): esperamos y
      // reintentamos en vez de abortar todo el research de golpe.
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (result.status === "completed") {
      const reportText = extractReportText(result);
      if (!reportText.trim()) {
        throw new DeepResearchError("Gemini terminó pero no devolvió texto en el informe.", prompt);
      }
      return { prompt, reportText };
    }

    if (result.status === "failed" || result.status === "cancelled" || result.status === "budget_exceeded") {
      throw new DeepResearchError(
        `El Deep Research terminó con estado "${result.status}" en la API de Gemini.`,
        prompt
      );
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
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
