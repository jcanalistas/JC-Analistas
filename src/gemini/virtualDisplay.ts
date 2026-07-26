import { spawn } from "node:child_process";

let started = false;

/**
 * Arranca un display X virtual (Xvfb) si no hay ninguno ya disponible, y
 * fija DISPLAY para que Chrome pueda abrirse en modo "visible" (headless:
 * false) contra él. Necesario porque Google detecta y bloquea el login/uso
 * de Gemini cuando Chrome corre en modo headless real, incluso con las
 * cookies de sesión correctas.
 *
 * Sin efecto si ya existe DISPLAY (p.ej. en local, dentro del escritorio
 * virtual de Cloud Shell) o si ya se llamó antes en este proceso.
 */
export async function ensureVirtualDisplay(): Promise<void> {
  if (started || process.env.DISPLAY) {
    started = true;
    return;
  }

  const display = ":99";
  const xvfb = spawn("Xvfb", [display, "-screen", "0", "1366x768x24", "-nolisten", "tcp"], {
    stdio: "ignore",
  });
  xvfb.on("error", (err) => {
    console.error("No se pudo arrancar Xvfb (¿falta instalar el paquete xvfb en la imagen?):", err);
  });

  process.env.DISPLAY = display;
  started = true;

  // Pequeño margen para que Xvfb levante el socket del display antes de
  // que Chrome intente conectarse.
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
