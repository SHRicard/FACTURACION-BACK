// Cómo se escriben la plata y las fechas en lo que ve el cliente (PDF, mails,
// WhatsApp).
//
// Las fechas van fijadas a la hora de Argentina: el server puede correr en
// UTC, y una compra del viernes a las 22 hs no puede aparecer como del sábado.

export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";

const pesosEnteros = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const pesosConCentavos = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$ 66.500", o "$ 1.234,50" si hay centavos. Nunca "$ 1.234,5". */
export function formatearPesos(monto: number): string {
  const redondeado = Math.round(monto * 100) / 100;
  return (Number.isInteger(redondeado) ? pesosEnteros : pesosConCentavos).format(redondeado);
}

const fecha = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const fechaHora = new Intl.DateTimeFormat("es-AR", {
  timeZone: ZONA_HORARIA,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// en-CA formatea como aaaa-mm-dd, que es lo que queremos para un nombre de archivo.
const fechaIsoLocal = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "06/09/2026" */
export const formatearFecha = (d: Date): string => fecha.format(d);

/**
 * "06/09". Sale de la fecha completa: el formato corto de es-AR no rellena el
 * mes aunque se le pida "2-digit" y devuelve "6/9".
 */
export const formatearFechaCorta = (d: Date): string => formatearFecha(d).slice(0, 5);

/**
 * Días de calendario entre dos fechas, en hora de Argentina. Una factura que
 * vence hoy a las 23:59 está a 0 días, no a 1 como da redondear las horas.
 */
export const diasEntre = (desde: Date, hasta: Date): number =>
  Math.round((Date.parse(fechaIso(hasta)) - Date.parse(fechaIso(desde))) / 86_400_000);

/** "06/09/2026 13:00" */
export const formatearFechaHora = (d: Date): string => fechaHora.format(d).replace(",", "");

/** "2026-09-06", en hora de Argentina. */
export const fechaIso = (d: Date): string => fechaIsoLocal.format(d);

/** "N° 0012". Sin número (factura abierta) devuelve null. */
export const numeroFactura = (numero?: number | null): string | null =>
  numero ? `N° ${String(numero).padStart(4, "0")}` : null;

/**
 * Texto apto para un nombre de archivo: "Ana López Ñandú" → "ana-lopez-nandu".
 * Solo ASCII, así el Content-Disposition no necesita codificación extra.
 */
export function slug(texto: string, maximo = 40): string {
  const limpio = texto
    .normalize("NFD")
    // NFD separa "ó" en "o" + tilde; acá se van las tildes (marcas combinantes).
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximo)
    .replace(/-+$/, "");

  return limpio || "cliente";
}
