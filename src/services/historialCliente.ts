import { Types } from "mongoose";
import Cliente from "../models/Cliente.js";
import Factura from "../models/Factura.js";
import Ticket, { faltanteDe } from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import { noEncontrado } from "../utils/AppError.js";
import { DIA_MS } from "../utils/fechas.js";
import { redondearPesos, serializarFactura } from "./facturacion.js";
import { diasEntreCompras } from "./visitas.js";
import { evaluarFacturas, resumirCumplimiento } from "./metricas/pagosATiempo.js";
import { respuestaPaginada, saltear, type Paginacion } from "../utils/consulta.js";

/**
 * Toda la historia de un cliente con la marca, en una sola respuesta:
 *
 *   cliente       sus datos
 *   resumen       cuánto debe, cuánto compró, cómo viene pagando
 *   facturas      todas, la más nueva primero
 *   movimientos   sus compras y sus pagos mezclados, paginados
 *
 * Es para decidir cómo cobrarle o si fiarle más: la ficha sola muestra la
 * deuda de hoy, y eso no alcanza. Ver doc/HISTORIAL_CLIENTE.md.
 *
 * Los anulados VIENEN en los movimientos, para mostrarlos tachados, pero no
 * suman en ningún número.
 */

export const TIPOS_MOVIMIENTO = ["todos", "compras", "pagos"] as const;
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

export interface OpcionesHistorial {
  /** Filtra solo los movimientos: el resumen y las facturas son de todo. */
  tipo: TipoMovimiento;
  paginacion: Paginacion;
}

/** Quién lo cargó, ya populado. Null si el usuario ya no está. */
function quien(usuario: unknown) {
  const u = usuario as { _id?: Types.ObjectId; nombre?: string } | null | undefined;
  return u?._id && u.nombre ? { _id: u._id, nombre: u.nombre } : null;
}

const dias = (desde: Date, hasta: Date) => (hasta.getTime() - desde.getTime()) / DIA_MS;

export async function historialCliente(
  marca: Types.ObjectId,
  clienteId: string,
  { tipo, paginacion }: OpcionesHistorial,
  ahora = new Date()
) {
  const cliente = Types.ObjectId.isValid(clienteId)
    ? await Cliente.findOne({ _id: clienteId, marca })
    : null;
  if (!cliente) throw noEncontrado("Cliente");

  const suyo = { cliente: cliente._id, marca };
  const [facturas, tickets, pagos, evaluadas] = await Promise.all([
    Factura.find(suyo).sort({ desde: -1 }),
    Ticket.find(suyo).sort({ fecha: -1 }).populate("registradoPor", "nombre"),
    Pago.find(suyo).sort({ fecha: -1 }).populate("registradoPor", "nombre"),
    // El cumplimiento de todas sus facturas: lo mismo que "mejores clientes".
    evaluarFacturas(marca, undefined, ahora, [cliente._id]),
  ]);

  // ── Movimientos: compras y pagos en una sola lista ──────────
  const numeroDe = new Map(facturas.map((f) => [String(f._id), f.numero ?? null]));
  const comun = (m: { _id: Types.ObjectId; fecha: Date; factura: Types.ObjectId; registradoPor?: unknown; anulado?: boolean; anuladoEl?: Date | undefined; motivoAnulacion?: string | undefined }) => ({
    _id: m._id,
    fecha: m.fecha,
    factura: { _id: m.factura, numero: numeroDe.get(String(m.factura)) ?? null },
    registradoPor: quien(m.registradoPor),
    anulado: !!m.anulado,
    anuladoEl: m.anuladoEl ?? null,
    motivoAnulacion: m.motivoAnulacion ?? null,
    saldoPosterior: null as number | null,
  });

  const movimientos = [
    ...tickets.map((t) => ({
      tipo: "compra" as const,
      ...comun(t),
      items: t.items.map((i) => ({
        nombre: i.nombre,
        talle: i.talle ?? null,
        especieNombre: i.especieNombre,
        cantidad: i.cantidad,
        precioUnitario: i.precioUnitario,
        subtotal: i.subtotal,
      })),
      total: t.total,
      pagado: t.pagado ?? 0,
      faltante: faltanteDe(t),
      /** Lo que le movió a la deuda: interno, no se devuelve. */
      cambio: t.anulado ? 0 : faltanteDe(t),
    })),
    ...pagos.map((p) => ({
      tipo: "pago" as const,
      ...comun(p),
      monto: p.monto,
      metodoPago: p.metodoPago ?? "efectivo",
      nota: p.nota ?? null,
      cambio: p.anulado ? 0 : -p.monto,
    })),
  ];

  // Del más nuevo al más viejo. El _id desempata los del mismo instante, así
  // una página no repite ni saltea renglones.
  movimientos.sort(
    (a, b) => b.fecha.getTime() - a.fecha.getTime() || (String(b._id) > String(a._id) ? 1 : -1)
  );

  // Cuánto debía después de cada movimiento: se recorre al revés (del más
  // viejo al más nuevo) sumando lo fiado y restando lo pagado. El del último
  // movimiento tiene que dar la deuda de hoy.
  let acumulado = 0;
  for (let i = movimientos.length - 1; i >= 0; i--) {
    const m = movimientos[i]!;
    if (m.anulado) continue;
    acumulado = redondearPesos(acumulado + m.cambio);
    m.saldoPosterior = acumulado;
  }

  const buscados = tipo === "compras" ? "compra" : tipo === "pagos" ? "pago" : null;
  const filtrados = buscados ? movimientos.filter((m) => m.tipo === buscados) : movimientos;
  const pagina = filtrados
    .slice(saltear(paginacion), saltear(paginacion) + paginacion.porPagina)
    // `cambio` es de acá adentro: el front no lo necesita.
    .map(({ cambio, ...m }) => m);

  // ── Resumen: toda su historia, sin anulados ─────────────────
  const compras = tickets.filter((t) => !t.anulado);
  const cobros = pagos.filter((p) => !p.anulado);
  const sumar = <T>(xs: T[], valor: (x: T) => number) => redondearPesos(xs.reduce((t, x) => t + valor(x), 0));

  const totalComprado = sumar(compras, (t) => t.total);
  const activa = facturas.find((f) => f.estado === "abierta");
  const vencida = !!activa && activa.saldo > 0 && activa.venceEl < ahora;
  // Ya vienen ordenados por fecha descendente.
  const ultimaCompra = compras[0];
  const ultimoPago = cobros[0];

  const resumen = {
    deuda: redondearPesos(activa?.saldo ?? 0),
    moroso: vencida,
    diasDeAtraso: vencida ? Math.ceil(dias(activa.venceEl, ahora)) : null,

    totalComprado,
    totalPagadoAlComprar: sumar(compras, (t) => t.pagado ?? 0),
    totalFiado: sumar(compras, faltanteDe),
    totalPagos: sumar(cobros, (p) => p.monto),
    cantidadTickets: compras.length,
    cantidadPagos: cobros.length,
    ticketPromedio: compras.length ? redondearPesos(totalComprado / compras.length) : null,

    primeraCompra: compras.at(-1)?.fecha ?? null,
    ultimaCompra: ultimaCompra ? { fecha: ultimaCompra.fecha, total: ultimaCompra.total } : null,
    ultimoPago: ultimoPago ? { fecha: ultimoPago.fecha, monto: ultimoPago.monto } : null,
    diasSinPagar: ultimoPago ? Math.floor(dias(ultimoPago.fecha, ahora)) : null,
    diasEntreCompras: diasEntreCompras(compras.map((t) => t.fecha)),

    cumplimiento: resumirCumplimiento(evaluadas),
  };

  return {
    cliente: cliente.toJSON(),
    resumen,
    facturas: facturas.map(serializarFactura),
    movimientos: respuestaPaginada(pagina, filtrados.length, paginacion),
  };
}
