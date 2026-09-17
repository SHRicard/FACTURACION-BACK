import type { Response } from "express";

export interface OpcionesPdf {
  buffer: Buffer;
  nombreArchivo: string;
  /** attachment = se descarga; inline = el navegador lo abre. */
  disposicion?: "attachment" | "inline";
}

/**
 * Manda un PDF como respuesta.
 *
 * `no-store` porque el PDF se arma con los datos del momento y es personal:
 * ni el navegador ni un proxy tienen que guardar una copia vieja.
 */
export function enviarPdf(
  res: Response,
  { buffer, nombreArchivo, disposicion = "attachment" }: OpcionesPdf
): void {
  res.set({
    "Content-Type": "application/pdf",
    "Content-Length": String(buffer.length),
    // El nombre ya viene en ASCII (ver slug), así que no hace falta filename*.
    "Content-Disposition": `${disposicion}; filename="${nombreArchivo}"`,
    "Cache-Control": "private, no-store",
  });
  res.end(buffer);
}
