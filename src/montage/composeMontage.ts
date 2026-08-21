import sharp from "sharp";
import { JC_ANALISTAS_LOGO_BASE64 } from "./logoAsset";

// Radio de las esquinas redondeadas del ticket, como fracción de su ancho.
const CORNER_RADIUS_RATIO = 0.05;

// Logo en la esquina superior derecha: ancho y margen como fracción del
// ancho del fondo (para que se vea proporcionado igual en fondos
// pequeños que panorámicos). Sin círculo ni fondo blanco detrás — solo
// el propio logo (navy) con un contorno blanco fino alrededor de sus
// líneas, para que se vea igual de bien en fotos claras que oscuras.
const LOGO_SIZE_RATIO = 0.08;
const LOGO_MARGIN_RATIO = 0.03;
const LOGO_STROKE_RATIO = 0.025;

/**
 * Superpone la tarjeta del ticket de apuesta (ya recortada, sin fondo
 * blanco alrededor) centrada sobre la foto de fondo, con las esquinas
 * redondeadas, manteniendo el tamaño/proporción original de la foto de
 * fondo. Añade también el logo de JC Analistas en la esquina superior
 * derecha.
 */
export async function composeMontage(ticketBuffer: Buffer, backgroundBuffer: Buffer): Promise<Buffer> {
  const backgroundMeta = await sharp(backgroundBuffer).metadata();
  const bgWidth = backgroundMeta.width;
  const bgHeight = backgroundMeta.height;

  if (!bgWidth || !bgHeight) {
    throw new Error("No se pudo leer el tamaño de la foto de fondo.");
  }

  // El ticket ocupa como mucho el 85% del ancho Y el 85% del alto del
  // fondo (lo que primero se alcance), manteniendo su propia proporción
  // (nunca se deforma ni se sale por arriba/abajo con fondos panorámicos).
  const maxTicketWidth = Math.round(bgWidth * 0.85);
  const maxTicketHeight = Math.round(bgHeight * 0.85);
  const resizedTicket = await sharp(ticketBuffer)
    .resize({ width: maxTicketWidth, height: maxTicketHeight, fit: "inside", withoutEnlargement: true })
    .toBuffer();

  const ticketMeta = await sharp(resizedTicket).metadata();
  const ticketWidth = ticketMeta.width ?? maxTicketWidth;
  const ticketHeight = ticketMeta.height ?? 0;

  const roundedTicket = await roundCorners(
    resizedTicket,
    ticketWidth,
    ticketHeight,
    Math.round(ticketWidth * CORNER_RADIUS_RATIO)
  );

  const left = Math.round((bgWidth - ticketWidth) / 2);
  const top = Math.round((bgHeight - ticketHeight) / 2);

  const logo = await buildLogo(bgWidth);
  const logoMeta = await sharp(logo).metadata();
  const logoWidth = logoMeta.width ?? 0;
  const margin = Math.round(bgWidth * LOGO_MARGIN_RATIO);

  return sharp(backgroundBuffer)
    .composite([
      { input: roundedTicket, left, top },
      { input: logo, left: bgWidth - logoWidth - margin, top: margin },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Logo de JC Analistas, recortado a su contenido real (sin el margen
 * transparente asimétrico que trae el PNG original — si no, al colocarlo
 * en la esquina se ve descuadrado), redimensionado al ancho indicado como
 * fracción del ancho del fondo, y con un contorno blanco fino alrededor
 * de sus líneas (para que se vea igual sobre fotos claras u oscuras, sin
 * necesidad de ponerle un círculo/fondo de color detrás).
 */
async function buildLogo(backgroundWidth: number): Promise<Buffer> {
  const trimmed = await sharp(Buffer.from(JC_ANALISTAS_LOGO_BASE64, "base64")).trim().toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();
  const originalWidth = trimmedMeta.width ?? 1;
  const originalHeight = trimmedMeta.height ?? 1;

  const width = Math.max(16, Math.round(backgroundWidth * LOGO_SIZE_RATIO));
  const height = Math.round(width * (originalHeight / originalWidth));
  const resizedLogo = await sharp(trimmed).resize(width, height).toBuffer();

  // Contorno: se "dilata" el canal alfa del logo (difuminarlo y volver a
  // binarizarlo esparce la zona opaca hacia fuera unos px) y se usa como
  // máscara de un relleno blanco — el resultado es un halo blanco que
  // sobresale un poco por fuera de cada línea del logo original.
  const strokeWidth = Math.max(1, Math.round(width * LOGO_STROKE_RATIO));
  const dilatedAlpha = await sharp(resizedLogo)
    .ensureAlpha()
    .extractChannel(3)
    .blur(strokeWidth)
    .threshold(10)
    .raw()
    .toBuffer();

  const halo = await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } } })
    .joinChannel(dilatedAlpha, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();

  return sharp(halo)
    .composite([{ input: resizedLogo, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

/** Recorta una imagen a un rectángulo con esquinas redondeadas, vía máscara SVG. */
async function roundCorners(
  imageBuffer: Buffer,
  width: number,
  height: number,
  radius: number
): Promise<Buffer> {
  const mask = Buffer.from(
    `<svg width="${width}" height="${height}">
       <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="#fff"/>
     </svg>`
  );

  return sharp(imageBuffer)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}
