import sharp from "sharp";

// Radio de las esquinas redondeadas del ticket, como fracción de su ancho.
const CORNER_RADIUS_RATIO = 0.05;

/**
 * Superpone la tarjeta del ticket de apuesta (ya recortada, sin fondo
 * blanco alrededor) centrada sobre la foto de fondo, con las esquinas
 * redondeadas, manteniendo el tamaño/proporción original de la foto de
 * fondo.
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

  return sharp(backgroundBuffer)
    .composite([{ input: roundedTicket, left, top }])
    .jpeg({ quality: 92 })
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
