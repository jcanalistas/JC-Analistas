/**
 * Script de diagnóstico: abre Gemini en un navegador VISIBLE reutilizando
 * la sesión ya guardada (sin volver a loguearse), y lo deja abierto
 * indefinidamente para poder inspeccionar la interfaz real a mano —
 * útil cuando la automatización de Deep Research falla porque Google
 * cambió el HTML/menús de gemini.google.com.
 *
 * Uso: npm run gemini:debug
 */
import path from "node:path";
import { chromium } from "playwright";
import { GEMINI_URL } from "./selectors";

// Ojo: este script NO importa src/config/env.ts a propósito. env.ts exige
// variables como TELEGRAM_BOT_TOKEN que no existen en un checkout suelto
// (p. ej. en Cloud Shell, donde solo se usa este script de diagnóstico).
const STORAGE_STATE_PATH = path.join(process.cwd(), "storage", "gemini-session.json");

async function main() {
  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: null,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = await context.newPage();
  await page.goto(GEMINI_URL);

  console.log("\n============================================================");
  console.log("Navegador abierto con tu sesión de Gemini ya logueada.");
  console.log("Cambia a la pestaña del escritorio virtual para verlo e interactuar.");
  console.log("Busca el botón para activar 'Deep Research' / 'Investigación exhaustiva'");
  console.log("cerca de la caja de texto, y manda capturas de lo que veas.");
  console.log("Deja esta terminal abierta. Pulsa Ctrl+C aquí cuando termines.");
  console.log("============================================================\n");

  await new Promise(() => {});
}

main().catch((err) => {
  console.error("Error abriendo Gemini:", err);
  process.exit(1);
});
