import sharp from "sharp";
import { JC_ANALISTAS_LOGO_BASE64 } from "./logoAsset";

// Radio de las esquinas redondeadas del ticket, como fracción de su ancho.
const CORNER_RADIUS_RATIO = 0.05;

// Logo en la esquina superior derecha, sobre un círculo blanco ajustado
// (poco margen entre el logo y el borde del círculo). Tamaño y margen
// respecto al fondo como fracción de su ancho, para verse proporcionado
// igual en fotos pequeñas que grandes.
const LOGO_SIZE_RATIO = 0.075;
const LOGO_MARGIN_RATIO = 0.03;
// Cuánto más grande es el círculo blanco que el propio logo (1.08 = 8% de margen).
const BADGE_PADDING_FACTOR = 1.08;

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

  const badge = await buildLogoBadge(bgWidth);
  const badgeMeta = await sharp(badge).metadata();
  const badgeSize = badgeMeta.width ?? 0;
  const margin = Math.round(bgWidth * LOGO_MARGIN_RATIO);

  return sharp(backgroundBuffer)
    .composite([
      { input: roundedTicket, left, top },
      { input: badge, left: bgWidth - badgeSize - margin, top: margin },
    ])
    .jpeg({ quality: 92 })
    .toBuffer();
}

/**
 * Círculo blanco ajustado al logo de JC Analistas (poco margen entre el
 * logo y el borde del círculo), del tamaño (ancho objetivo del logo en
 * px) que corresponda al ancho del fondo. El logo se recorta antes a su
 * contenido real (sin el margen transparente asimétrico que trae el PNG
 * original — si no, al centrarlo se ve descuadrado).
 */
async function buildLogoBadge(backgroundWidth: number): Promise<Buffer> {
  const trimmed = await sharp(Buffer.from(JC_ANALISTAS_LOGO_BASE64, "base64")).trim().toBuffer();
  const trimmedMeta = await sharp(trimmed).metadata();
  const originalWidth = trimmedMeta.width ?? 1;
  const originalHeight = trimmedMeta.height ?? 1;

  const logoWidth = Math.max(16, Math.round(backgroundWidth * LOGO_SIZE_RATIO));
  const logoHeight = Math.round(logoWidth * (originalHeight / originalWidth));
  const resizedLogo = await sharp(trimmed).resize(logoWidth, logoHeight).toBuffer();

  const badgeSize = Math.round(Math.max(logoWidth, logoHeight) * BADGE_PADDING_FACTOR);
  const whiteDisc = Buffer.from(
    `<svg width="${badgeSize}" height="${badgeSize}"><circle cx="${badgeSize / 2}" cy="${badgeSize / 2}" r="${badgeSize / 2}" fill="#ffffff"/></svg>`
  );
  const logoLeft = Math.round((badgeSize - logoWidth) / 2);
  const logoTop = Math.round((badgeSize - logoHeight) / 2);

  return sharp({
    create: { width: badgeSize, height: badgeSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: whiteDisc, left: 0, top: 0 },
      { input: resizedLogo, left: logoLeft, top: logoTop },
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
