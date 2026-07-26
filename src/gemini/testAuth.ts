/**
 * Diagnóstico: lanza Chrome exactamente con la misma configuración que
 * usa el bot en producción (mismos args, mismo storageState, mismo
 * script anti-detección) y comprueba si Gemini carga logueado o muestra
 * la página pública de "Sign in".
 *
 * Se ejecuta en Cloud Shell (mismo sitio donde el login manual sí
 * funciona) para averiguar si el problema es específico del entorno de
 * Cloud Run o está en el propio código de automatización.
 *
 * Uso: npm run gemini:test-auth
 */
import path from "node:path";
import { chromium } from "playwright";
import { GEMINI_URL, SELECTORS } from "./selectors";
import { ensureVirtualDisplay } from "./virtualDisplay";

const STORAGE_STATE_PATH = path.join(process.cwd(), "storage", "gemini-session.json");
const SCREENSHOT_PATH = path.join(process.cwd(), "auth-test.png");

async function main() {
  await ensureVirtualDisplay();

  const browser = await chromium.launch({
    headless: false,
    channel: "chrome",
    args: [
      "--disable-blink-features=AutomationControlled",
      "--window-size=1366,768",
      "--window-position=0,0",
    ],
  });
  const context = await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    viewport: null,
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  const page = await context.newPage();
  await page.goto(GEMINI_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  await page.screenshot({ path: SCREENSHOT_PATH });

  const signInVisible = await page
    .locator('text="Sign in"')
    .first()
    .isVisible()
    .catch(() => false);
  const spanishBoxVisible = await page
    .locator(SELECTORS.promptInput)
    .first()
    .isVisible()
    .catch(() => false);
  const bodyText = await page.locator("body").innerText().catch(() => "");

  console.log("\n============================================================");
  console.log("¿Botón 'Sign in' visible? (= NO logueado):", signInVisible);
  console.log("¿Caja de texto detectada?:", spanishBoxVisible);
  console.log("Screenshot guardado en:", SCREENSHOT_PATH);
  console.log("------------------------------------------------------------");
  console.log("Primeros 200 caracteres visibles de la página:");
  console.log(bodyText.slice(0, 200));
  console.log("============================================================\n");

  await browser.close();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
