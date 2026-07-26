/**
 * Selectores de la interfaz web de gemini.google.com usados por la
 * automatización de Deep Research.
 *
 * IMPORTANTE: Google cambia el HTML de Gemini con frecuencia sin previo
 * aviso. Si la automatización empieza a fallar, lo más probable es que
 * algún selector de aquí ya no coincida con la web real. Este archivo
 * centraliza todos los selectores para que ajustarlos sea rápido, sin
 * tener que tocar la lógica en deepResearch.ts.
 *
 * Cómo depurar un selector roto:
 *   1. Cambia `headless: false` en deepResearch.ts temporalmente.
 *   2. Corre el flujo y observa en qué paso se queda colgado.
 *   3. Inspecciona el elemento en DevTools y actualiza el selector aquí.
 */
export const GEMINI_URL = "https://gemini.google.com/app";

export const SELECTORS = {
  // Caja de texto principal donde se escribe el prompt
  promptInput: 'div[contenteditable="true"].ql-editor, div[aria-label*="Prompt" i][contenteditable="true"]',

  // Botón "+" / "Herramientas" que despliega el menú de modos (Deep Research, Canvas, etc.)
  toolsMenuButton: 'button[aria-label*="Herramientas" i], button[aria-label*="Tools" i]',

  // Opción "Investigación exhaustiva" / "Deep Research" dentro del menú de herramientas
  deepResearchOption:
    'text=/Investigaci[oó]n exhaustiva|Investigaci[oó]n a fondo|Deep Research/i',

  // Botón de enviar el prompt (avión de papel)
  sendButton: 'button[aria-label*="Enviar" i], button[aria-label*="Send" i]',

  // Botón para confirmar/lanzar el plan de investigación que propone Gemini
  startResearchButton:
    'button:has-text("Iniciar investigación"), button:has-text("Start research")',

  // Indicador de que la investigación sigue en curso (se usa para hacer polling)
  researchInProgressIndicator:
    'text=/Investigando|Researching|Generando el informe|Creating the report/i',

  // Botón que aparece cuando el informe final ya está listo
  reportReadyIndicator:
    'button[aria-label*="Exportar" i], button[aria-label*="Export" i], text=/Informe final|Final report/i',

  // Contenedor con el texto de la última respuesta del modelo (el informe)
  lastResponseContainer: 'message-content, div[data-response-index]:last-of-type, div.model-response-text',
} as const;
