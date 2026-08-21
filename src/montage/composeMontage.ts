import sharp from "sharp";
import { JC_ANALISTAS_LOGO_BASE64 } from "./logoAsset";

// Radio de las esquinas redondeadas del ticket, como fracción de su ancho.
const CORNER_RADIUS_RATIO = 0.05;

// Sello del logo en la esquina superior derecha: diámetro y margen como
// fracción del ancho del fondo (para que se vea proporcionado igual en
// fondos pequeños que panorámicos), y cuánto ocupa el logo dentro del
// círculo blanco (deja un pequeño borde blanco alrededor para que
// resalte incluso sobre fondos oscuros o muy recargados).
const LOGO_BADGE_SIZE_RATIO = 0.08;
const LOGO_MARGIN_RATIO = 0.03;
const LOGO_INNER_RATIO = 0.86;

/**
 * Superpone la tarjeta del ticket de apuesta (ya recortada, sin fondo
 * blanco alrededor) centrada sobre la foto de fondo, con las esquinas
 * redondeadas, manteniendo el tamaño/proporción original de la foto de
 * fondo. Añade también el sello del logo de JC Analistas en la esquina
 * superior derecha.
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

  const badgeSize = Math.max(24, Math.round(bgWidth * LOGO_BADGE_SIZE_RATIO));
  const badgeMargin = Math.round(bgWidth * LOGO_MARGIN_RATIO);
  const logoBadge = await buildLogoBadge(badgeSize);

  return sharp(backgroundBuffer)
    .composite([
      { input: roundedTicket, left, top },
      { input: logoBadge, left: bgWidth - badgeSize - badgeMargin, top: badgeMargin },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Círculo blanco con el logo de JC Analistas centrado dentro, del tamaño (diámetro en px) indicado. */
async function buildLogoBadge(size: number): Promise<Buffer> {
  const whiteDisc = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#ffffff"/></svg>`
  );

  const logoSize = Math.round(size * LOGO_INNER_RATIO);
  const logoOffset = Math.round((size - logoSize) / 2);
  const logo = await sharp(Buffer.from(JC_ANALISTAS_LOGO_BASE64, "base64")).resize(logoSize, logoSize).toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: whiteDisc, left: 0, top: 0 },
      { input: logo, left: logoOffset, top: logoOffset },
    ])
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
