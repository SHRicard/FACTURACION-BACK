/**
 * El cumplimiento de una factura: qué tan bien pagó el cliente, de 0 a 100.
 *
 * Cada peso que se fió cuenta según cuándo volvió:
 *
 *   pagado hasta el vencimiento   → vale 100%
 *   pagado tarde                  → pierde 2% por cada día de atraso (a los 50 días, 0)
 *   todavía sin pagar             → 0
 *
 *   cumplimiento = Σ (monto de cada pago × lo que vale) ÷ total fiado
 *
 * Andrés se lleva $500.000 y vence el 10/04:
 *
 *   paga todo el 10/04                  → 100%
 *   paga todo el 15/04 (5 días tarde)   → 90%
 *   deja $300.000 el 15/04              → 54%, y sube cuando pague el resto
 *
 * Se mide contra el vencimiento ORIGINAL: si después se le reprogramó la
 * fecha, el atraso respecto de lo que se acordó primero no se borra.
 */

/** Cuánto pierde un pago por cada día que llega tarde, en puntos de porcentaje. */
export const DESCUENTO_POR_DIA_DE_ATRASO = 2;

const DIA_MS = 86_400_000;

/** Días que pasaron del vencimiento. 0 si llegó a tiempo; unas horas tarde ya es 1. */
export const diasDeAtraso = (fecha: Date, vence: Date): number =>
  Math.max(0, Math.ceil((fecha.getTime() - vence.getTime()) / DIA_MS));

/** Cuánto vale un pago hecho en esa fecha, de 0 a 1. */
export const valorDelPago = (fecha: Date, vence: Date): number =>
  Math.max(0, 100 - DESCUENTO_POR_DIA_DE_ATRASO * diasDeAtraso(fecha, vence)) / 100;

/** Null si no hay nada que medir: sin vencimiento o sin nada fiado. */
export function calcularCumplimiento(
  totalFiado: number,
  pagos: { fecha: Date; monto: number }[],
  vence: Date | null | undefined
): number | null {
  if (!vence || totalFiado <= 0) return null;

  const ponderado = pagos.reduce((t, p) => t + p.monto * valorDelPago(p.fecha, vence), 0);
  // Tope en 100: si se anuló un ticket después de pagar, lo pagado puede
  // superar lo fiado.
  return Math.min(100, Math.round((ponderado / totalFiado) * 1000) / 10);
}
