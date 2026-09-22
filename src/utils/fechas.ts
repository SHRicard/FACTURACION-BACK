import { ZONA_HORARIA } from "./formato.js";

/** Un día en milisegundos. */
export const DIA_MS = 86_400_000;

/**
 * Fechas del ciclo de facturación.
 *
 * El ciclo es por cliente: cada uno tiene su ventana de pago (por ejemplo del 1
 * al 10, o del 20 al 30). De ahí sale el vencimiento de su factura, si el
 * administrador no acordó otra fecha.
 */

// ─────────────────────────────────────────────────────────────
// Días en hora de Argentina
//
// El server puede correr en UTC. Una fecha que elige el usuario ("vence el
// 10/04") o un corte de período tiene que caer en el día de Argentina, no en
// el de Greenwich: si no, lo del 30 a las 22 hs aparece como del 31.

const formatoPartes = new Intl.DateTimeFormat("en-US", {
  timeZone: ZONA_HORARIA,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partesEnZona(fecha: Date) {
  const p: Record<string, number> = {};
  for (const { type, value } of formatoPartes.formatToParts(fecha)) p[type] = Number(value);
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** El día (año, mes 1-12, día) de un instante, visto desde Argentina. */
export function diaEnZona(fecha: Date): { anio: number; mes: number; dia: number } {
  const p = partesEnZona(fecha);
  return { anio: p.year, mes: p.month, dia: p.day };
}

/**
 * El instante en que empieza ese día en Argentina. `mes` va de 1 a 12, y se
 * puede pasar de rango: el día 32 es el 1 del mes siguiente.
 */
export function inicioDelDiaEnZona(anio: number, mes: number, dia: number): Date {
  const comoUtc = Date.UTC(anio, mes - 1, dia);
  const p = partesEnZona(new Date(comoUtc));
  const desfase = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - comoUtc;
  return new Date(comoUtc - desfase);
}

/** El último instante de ese día en Argentina: así vence una fecha elegida. */
export const finDelDiaEnZona = (anio: number, mes: number, dia: number): Date =>
  new Date(inicioDelDiaEnZona(anio, mes, dia + 1).getTime() - 1);

// ─────────────────────────────────────────────────────────────
// La ventana de pago

/**
 * Cuántos días tiene el mes (0-11, admite desborde). Contempla los bisiestos.
 * En UTC para no depender de la zona del server.
 */
export const diasDelMes = (anio: number, mes: number): number =>
  new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();

/**
 * Devuelve el día `dia` de ese mes, recortado si el mes es más corto.
 *
 * Es el caso que rompe todo si no se contempla: un cliente que paga el 31 no
 * tiene 31 en febrero. En vez de irse al 3 de marzo (que es lo que hace
 * `new Date(2026, 1, 31)`), se queda en el 28.
 */
export function diaDelMes(anio: number, mes: number, dia: number, finDelDia = false): Date {
  const diaReal = Math.min(dia, diasDelMes(anio, mes));
  // En hora de Argentina: con new Date(anio, mes, dia, 23, 59, 59) un server en
  // UTC vencía a las 20:59 de acá. `mes` va de 0 a 11 y las funciones EnZona
  // lo esperan de 1 a 12; las dos admiten desborde (el 12 es enero del otro año).
  return finDelDia
    ? finDelDiaEnZona(anio, mes + 1, diaReal)
    : inicioDelDiaEnZona(anio, mes + 1, diaReal);
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
  // El mes se mira desde Argentina: a las 22 hs del 31, un server en UTC ya
  // está en el mes siguiente. `mes` sale de 1 a 12.
  const { anio, mes } = diaEnZona(desde);

  const esteMes = diaDelMes(anio, mes - 1, ventana.hastaDia, true);
  if (esteMes >= desde) return esteMes;

  // Con índice 0-11, `mes` ya es el mes siguiente (diciembre desborda a enero).
  return diaDelMes(anio, mes, ventana.hastaDia, true);
}

/**
 * ¿Está vencida una factura con este vencimiento?
 *
 * Se calcula, no se guarda: si fuera un estado en la base, alguien tendría que
 * ir a marcarlo, y las facturas de clientes que dejaron de comprar quedarían
 * para siempre como al día.
 */
export const estaVencida = (venceEl: Date, ahora = new Date()): boolean => venceEl < ahora;

/**
 * Días de calendario de Argentina entre hoy y el vencimiento: 0 = vence hoy,
 * 1 = mañana, −1 = venció ayer, nunca −0.
 *
 * No se redondean horas: venceEl es el último instante del día, y el Math.ceil
 * de antes convertía cualquier fracción en un día más.
 */
export function diasCalendarioHasta(venceEl: Date, ahora = new Date()): number {
  const v = diaEnZona(venceEl);
  const h = diaEnZona(ahora);
  const n = Math.round(
    (Date.UTC(v.anio, v.mes - 1, v.dia) - Date.UTC(h.anio, h.mes - 1, h.dia)) / DIA_MS
  );
  return n === 0 ? 0 : n;
}
