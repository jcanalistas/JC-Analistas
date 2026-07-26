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
 *   1. Corre `npm run gemini:debug` (abre Gemini visible, reutilizando
 *      la sesión ya guardada) y reproduce el paso a mano en el
 *      escritorio virtual de Cloud Shell.
 *   2. Manda capturas del paso que falla.
 *   3. Actualiza el selector correspondiente aquí.
 *
 * Flujo real descubierto a mano (26/07): Gemini abre por defecto en el
 * modelo "Flash-Lite", que NO tiene Deep Research disponible. Hay que
 * cambiar primero al modelo "Flash", y luego entrar en el menú "+" →
 * "Más herramientas" → "Deep Research".
 */
export const GEMINI_URL = "https://gemini.google.com/app";

// Ancla estable: el propio campo de texto por su rol de accesibilidad
// (en vez de anclar por el texto del placeholder, que puede estar
// pintado por CSS y no ser texto real del DOM).
const TEXTBOX_SELECTOR = '[role="textbox"]';

export const SELECTORS = {
  // Caja de texto principal donde se escribe el prompt
  promptInput: `${TEXTBOX_SELECTOR}, div[contenteditable="true"].ql-editor`,

  // Botón que muestra el modelo actual (p.ej. "Flash-Lite"), a la derecha
  // de la caja de texto. Usamos la posición relativa (Playwright
  // :right-of) porque no tenemos un aria-label fiable.
  modelSelectorButton: `button:right-of(${TEXTBOX_SELECTOR})`,

  // Opción "X.Y Flash" (sin "-Lite") dentro del desplegable de modelos.
  // El número de versión cambia con el tiempo, por eso es una regexp.
  modelOptionFlash: 'text=/^\\d+(\\.\\d+)?\\s+Flash$/',

  // Botón "+" a la izquierda de la caja de texto: abre el menú de
  // adjuntos/herramientas (Subir archivos, Crear imagen, Más herramientas…)
  toolsPlusButton: `button:left-of(${TEXTBOX_SELECTOR})`,

  // Opción "Más herramientas" dentro de ese menú (abre un submenú flotante)
  moreToolsMenuItem: 'text="Más herramientas"',

  // Opción "Deep Research" dentro del submenú de "Más herramientas"
  deepResearchOption: 'text="Deep Research"',

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
