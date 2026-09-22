import type { Types } from "mongoose";
import Factura from "../../models/Factura.js";
import Ticket, { faltanteDe } from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";

/**
 * Cómo estaba la deuda de la marca en un momento cualquiera del pasado.
 *
 * No hay nada guardado por fecha: se reconstruye. De cada factura se toman sus
 * tickets y sus pagos, y se van sumando en orden hasta la fecha de corte; lo
 * que queda es lo que ese cliente debía ese día. Con eso se arma la foto:
 * quiénes debían, cuánto, y cuánto de eso ya estaba vencido.
 *
 * Lo usan las dos métricas que muestran una evolución:
 *
 *   morosos    mira los vencidos (`morosos`, `deudaVencida`)
 *   deudores   mira todo lo que se debe (`deudores`, `deuda`)
 *
 * Por eso un moroso es siempre también un deudor, pero no al revés.
 */

export interface FotoDeuda {
  /** Los clientes que debían algo. */
  deudores: Set<string>;
  /** Cuánta plata se debía en total. */
  deuda: number;
  /** Los que además ya tenían la factura vencida. */
  morosos: Set<string>;
  /** De la deuda, cuánta estaba vencida. */
  deudaVencida: number;
}

interface FacturaConFechas {
  _id: Types.ObjectId;
  cliente: Types.ObjectId;
  venceEl: Date;
  vencimientoOriginal?: Date | undefined;
  reprogramadaEl?: Date | undefined;
}

/**
 * Qué fecha de vencimiento valía en el instante `t`. Antes de reprogramarla,
 * la original. Si se reprogramó más de una vez, de las del medio no queda
 * registro: vale la original hasta la última reprogramación.
 */
function vencimientoEn(f: FacturaConFechas, t: number): number {
  if (f.reprogramadaEl && f.vencimientoOriginal && t < f.reprogramadaEl.getTime()) {
    return f.vencimientoOriginal.getTime();
  }
  return f.venceEl.getTime();
}

/**
 * Una foto por cada corte, en el mismo orden. Los cortes tienen que venir
 * ordenados de más viejo a más nuevo: se recorren los movimientos una sola vez.
 */
export async function fotosDeDeuda(marca: Types.ObjectId, cortes: number[]): Promise<FotoDeuda[]> {
  const primerCorte = new Date(cortes[0] ?? 0);
  const ultimoCorte = new Date(cortes.at(-1) ?? 0);

  const facturas: FacturaConFechas[] = await Factura.find({
    marca,
    estado: { $ne: "anulada" },
    totalFiado: { $gt: 0 },
    // Las que se saldaron antes del primer corte no debían nada en ninguno.
    $nor: [{ estado: "pagada", pagadaEl: { $lt: primerCorte } }],
  })
    .select("cliente venceEl vencimientoOriginal reprogramadaEl")
    .lean();

  const ids = facturas.map((f) => f._id);
  const [tickets, pagos] = await Promise.all([
    Ticket.find({ factura: { $in: ids }, anulado: { $ne: true }, fecha: { $lte: ultimoCorte } })
      .select("factura fecha total pagado")
      .lean(),
    Pago.find({ factura: { $in: ids }, anulado: { $ne: true }, fecha: { $lte: ultimoCorte } })
      .select("factura fecha monto")
      .lean(),
  ]);

  // Cada factura como una lista de movimientos: lo que se fió suma, lo que se
  // pagó resta.
  const movimientos = new Map<string, { fecha: number; monto: number }[]>();
  const anotar = (factura: Types.ObjectId, fecha: Date, monto: number) => {
    const id = String(factura);
    movimientos.set(id, [...(movimientos.get(id) ?? []), { fecha: fecha.getTime(), monto }]);
  };
  for (const t of tickets) anotar(t.factura, t.fecha, faltanteDe(t));
  for (const p of pagos) anotar(p.factura, p.fecha, -p.monto);

  const fotos: FotoDeuda[] = cortes.map(() => ({
    deudores: new Set<string>(),
    deuda: 0,
    morosos: new Set<string>(),
    deudaVencida: 0,
  }));

  for (const f of facturas) {
    const movs = (movimientos.get(String(f._id)) ?? []).sort((a, b) => a.fecha - b.fecha);
    const cliente = String(f.cliente);
    let i = 0;
    let deuda = 0;

    // Los cortes van en orden: la deuda se acumula sin volver a recorrer.
    cortes.forEach((corte, k) => {
      while (i < movs.length && movs[i]!.fecha <= corte) deuda += movs[i++]!.monto;
      // Los centavos de los floats no son una deuda.
      if (deuda <= 0.005) return;

      const foto = fotos[k]!;
      foto.deudores.add(cliente);
      foto.deuda += deuda;

      if (vencimientoEn(f, corte) < corte) {
        foto.morosos.add(cliente);
        foto.deudaVencida += deuda;
      }
    });
  }

  return fotos;
}

/** Los que están en `despues` y no estaban en `antes`. */
export const entraron = (antes: Set<string>, despues: Set<string>): number =>
  [...despues].filter((c) => !antes.has(c)).length;

/** Los que estaban en `antes` y ya no están en `despues`. */
export const salieron = (antes: Set<string>, despues: Set<string>): number =>
  [...antes].filter((c) => !despues.has(c)).length;
