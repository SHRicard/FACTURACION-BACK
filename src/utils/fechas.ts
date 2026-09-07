/**
 * Fechas del ciclo de facturación.
 *
 * El ciclo es por cliente: cada uno tiene su ventana de pago (por ejemplo del 1
 * al 10, o del 20 al 30). De ahí sale el vencimiento concreto de cada factura.
 */

/** Cuántos días tiene el mes de una fecha. Contempla los bisiestos. */
export const diasDelMes = (anio: number, mes: number): number =>
  new Date(anio, mes + 1, 0).getDate();

/**
 * Devuelve el día `dia` de ese mes, recortado si el mes es más corto.
 *
 * Es el caso que rompe todo si no se contempla: un cliente que paga el 31 no
 * tiene 31 en febrero. En vez de irse al 3 de marzo (que es lo que hace
 * `new Date(2026, 1, 31)`), se queda en el 28.
 */
export function diaDelMes(anio: number, mes: number, dia: number, finDelDia = false): Date {
  const diaReal = Math.min(dia, diasDelMes(anio, mes));
  return finDelDia
    ? new Date(anio, mes, diaReal, 23, 59, 59, 999)
    : new Date(anio, mes, diaReal, 0, 0, 0, 0);
}

export interface VentanaPago {
  /** Día del mes en que empieza a poder pagar. */
  desdeDia: number;
  /** Día del mes hasta el que tiene tiempo. Después de esto, está vencida. */
  hastaDia: number;
}

export const VENTANA_POR_DEFECTO: VentanaPago = { desdeDia: 1, hastaDia: 10 };

export function validarVentana(ventana: VentanaPago): void {
  const { desdeDia, hastaDia } = ventana;
  const enRango = (d: number) => Number.isInteger(d) && d >= 1 && d <= 31;

  if (!enRango(desdeDia) || !enRango(hastaDia)) {
    throw new Error("Los días de la ventana de pago tienen que estar entre 1 y 31");
  }
  if (desdeDia > hastaDia) {
    throw new Error("El día de inicio de la ventana no puede ser posterior al de fin");
  }
}

/**
 * Próximo vencimiento para un cliente, a partir de una fecha.
 *
 * Si el día de vencimiento de este mes ya pasó, se va al mes siguiente. Así una
 * factura abierta hoy siempre vence en el futuro, nunca nace vencida.
 */
export function proximoVencimiento(ventana: VentanaPago, desde = new Date()): Date {
  const anio = desde.getFullYear();
  const mes = desde.getMonth();

  const esteMes = diaDelMes(anio, mes, ventana.hastaDia, true);
  if (esteMes >= desde) return esteMes;

  return diaDelMes(anio, mes + 1, ventana.hastaDia, true);
}

/**
 * ¿Está vencida una factura con este vencimiento?
 *
 * Se calcula, no se guarda: si fuera un estado en la base, alguien tendría que
 * ir a marcarlo, y las facturas de clientes que dejaron de comprar quedarían
 * para siempre como al día.
 */
export const estaVencida = (venceEl: Date, ahora = new Date()): boolean => venceEl < ahora;
