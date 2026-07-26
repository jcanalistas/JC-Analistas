import fs from "node:fs";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { GEMINI_URL, SELECTORS } from "./selectors";
import { ensureVirtualDisplay } from "./virtualDisplay";

export interface DeepResearchResult {
  prompt: string;
  reportText: string;
}

export class DeepResearchError extends Error {
  /** Captura de pantalla del navegador en el momento del fallo, si se pudo tomar. */
  public screenshot?: Buffer;

  constructor(message: string, public readonly promptPreview: string) {
    super(message);
    this.name = "DeepResearchError";
  }
}

interface RunOptions {
  storageStatePath: string;
  timeoutMinutes: number;
  headless?: boolean;
}

/**
 * Ejecuta un único Deep Research en gemini.google.com para un prompt dado
 * y devuelve el texto completo del informe final.
 *
 * Reutiliza la sesión de Google guardada con `npm run gemini:login`, así
 * que no maneja login ni contraseñas.
 */
export async function runDeepResearch(
  prompt: string,
  options: RunOptions
): Promise<DeepResearchResult> {
  if (!fs.existsSync(options.storageStatePath)) {
    throw new DeepResearchError(
      `No se encontró la sesión de Gemini en ${options.storageStatePath}. ` +
        `Corre "npm run gemini:login" primero (o revisa el secreto montado en Cloud Run).`,
      prompt
    );
  }

  // Google detecta y bloquea el uso de Gemini en Chrome headless real
  // (muestra la página pública de "Sign in" en vez de la sesión logueada),
  // incluso con cookies de sesión válidas. Por eso corremos SIEMPRE en
  // modo "visible" (headless: false) contra un display virtual (Xvfb) en
  // vez de usar el modo headless nativo de Chrome.
  const headless = options.headless ?? false;
  if (!headless) {
    await ensureVirtualDisplay();
  }

  // Mismo canal "chrome" real y flags anti-detección que en captureLogin.ts.
  const browser: Browser = await chromium.launch({
    headless,
    channel: "chrome",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
      "--window-position=0,0",
    ],
  });
  const context: BrowserContext = await browser.newContext({
    storageState: options.storageStatePath,
    // viewport: null usa el tamaño real de la ventana (fijado arriba con
    // --window-size) en vez de forzar un viewport interno distinto.
    viewport: headless ? { width: 1366, height: 768 } : null,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  let page: import("playwright").Page | undefined;
  try {
    page = await context.newPage();
    await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
    await waitForChatReady(page);

    await switchToFlashModel(page);
    await selectDeepResearchMode(page);
    await submitPrompt(page, prompt);
    await confirmResearchPlanIfShown(page);
    await waitForReportReady(page, options.timeoutMinutes);

    const reportText = await extractLastResponseText(page);
    if (!reportText.trim()) {
      throw new DeepResearchError(
        "Gemini terminó pero no se pudo extraer texto del informe (selector desactualizado).",
        prompt
      );
    }

    return { prompt, reportText };
  } catch (err) {
    // Adjunta una captura del momento exacto del fallo, para poder
    // diagnosticar selectores rotos sin depender de reproducirlo a mano.
    const screenshot = await page?.screenshot({ type: "png" }).catch(() => undefined);
    if (err instanceof DeepResearchError) {
      err.screenshot = screenshot;
      throw err;
    }
    const wrapped = new DeepResearchError(
      `Error inesperado automatizando Gemini: ${err instanceof Error ? err.message : String(err)}`,
      prompt
    );
    wrapped.screenshot = screenshot;
    throw wrapped;
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Espera a que la caja de texto principal esté realmente visible antes
 * de interactuar. gemini.google.com es una SPA pesada: "domcontentloaded"
 * dispara mucho antes de que la interfaz de chat termine de montarse, y
 * en headless (sin nadie mirando la pantalla) no hay margen extra como
 * el que hay al probarlo a mano.
 */
async function waitForChatReady(page: import("playwright").Page): Promise<void> {
  try {
    await page.locator(SELECTORS.promptInput).first().waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    throw new DeepResearchError(
      "La interfaz de Gemini no terminó de cargar (la caja de texto principal nunca apareció). " +
        "Puede ser un problema temporal de carga o que la sesión haya caducado.",
      ""
    );
  }
}

/**
 * Gemini abre por defecto en el modelo "Flash-Lite", que no tiene Deep
 * Research disponible. Hay que cambiar antes al modelo "Flash".
 */
async function switchToFlashModel(page: import("playwright").Page): Promise<void> {
  try {
    const modelButton = page.locator(SELECTORS.modelSelectorButton).first();
    await modelButton.click({ timeout: 10_000 });

    const flashOption = page.locator(SELECTORS.modelOptionFlash).first();
    await flashOption.click({ timeout: 10_000 });
  } catch (err) {
    throw new DeepResearchError(
      "No se pudo cambiar al modelo Flash en Gemini (necesario para Deep Research). " +
        "Es probable que Google haya cambiado el selector de modelo: revisa src/gemini/selectors.ts.",
      ""
    );
  }
}

async function selectDeepResearchMode(page: import("playwright").Page): Promise<void> {
  try {
    const plusButton = page.locator(SELECTORS.toolsPlusButton).first();
    await plusButton.click({ timeout: 10_000 });

    const moreTools = page.locator(SELECTORS.moreToolsMenuItem).first();
    await moreTools.click({ timeout: 10_000 });

    const deepResearchOption = page.locator(SELECTORS.deepResearchOption).first();
    await deepResearchOption.click({ timeout: 10_000 });
  } catch (err) {
    throw new DeepResearchError(
      "No se pudo activar el modo Deep Research en la interfaz de Gemini. " +
        "Es probable que Google haya cambiado el menú de herramientas: revisa src/gemini/selectors.ts.",
      ""
    );
  }
}

async function submitPrompt(page: import("playwright").Page, prompt: string): Promise<void> {
  const input = page.locator(SELECTORS.promptInput).first();
  await input.click();
  await input.fill(prompt);

  const sendButton = page.locator(SELECTORS.sendButton).first();
  await sendButton.click();
}

async function confirmResearchPlanIfShown(page: import("playwright").Page): Promise<void> {
  const startButton = page.locator(SELECTORS.startResearchButton).first();
  const appeared = await startButton.isVisible({ timeout: 30_000 }).catch(() => false);
  if (appeared) {
    await startButton.click();
  }
}

async function waitForReportReady(
  page: import("playwright").Page,
  timeoutMinutes: number
): Promise<void> {
  const timeoutMs = timeoutMinutes * 60_000;
  try {
    await page.locator(SELECTORS.reportReadyIndicator).first().waitFor({
      state: "visible",
      timeout: timeoutMs,
    });
  } catch {
    throw new DeepResearchError(
      `Gemini no terminó el informe en ${timeoutMinutes} minutos. ` +
        `Puedes subir DEEP_RESEARCH_TIMEOUT_MINUTES en el .env si tus investigaciones tardan más.`,
      ""
    );
  }
}

async function extractLastResponseText(page: import("playwright").Page): Promise<string> {
  const container = page.locator(SELECTORS.lastResponseContainer).last();
  return (await container.innerText().catch(() => "")).trim();
}
