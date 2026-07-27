import sharp from "sharp";

/**
 * Superpone la tarjeta del ticket de apuesta (ya recortada, sin fondo
 * blanco alrededor) centrada sobre la foto de fondo, manteniendo el
 * tamaño/proporción original de la foto de fondo.
 */
export async function composeMontage(ticketBuffer: Buffer, backgroundBuffer: Buffer): Promise<Buffer> {
  const backgroundMeta = await sharp(backgroundBuffer).metadata();
  const bgWidth = backgroundMeta.width;
  const bgHeight = backgroundMeta.height;

  if (!bgWidth || !bgHeight) {
    throw new Error("No se pudo leer el tamaño de la foto de fondo.");
  }

  // El ticket ocupa como mucho el 85% del ancho del fondo, manteniendo su
  // propia proporción (nunca se deforma).
  const targetTicketWidth = Math.round(bgWidth * 0.85);
  const resizedTicket = await sharp(ticketBuffer)
    .resize({ width: targetTicketWidth, withoutEnlargement: true })
    .toBuffer();

  const ticketMeta = await sharp(resizedTicket).metadata();
  const ticketWidth = ticketMeta.width ?? targetTicketWidth;
  const ticketHeight = ticketMeta.height ?? 0;

  const left = Math.round((bgWidth - ticketWidth) / 2);
  const top = Math.round((bgHeight - ticketHeight) / 2);

  return sharp(backgroundBuffer)
    .composite([{ input: resizedTicket, left, top }])
    .jpeg({ quality: 92 })
    .toBuffer();
}
