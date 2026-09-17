import { Types } from "mongoose";
import Cliente from "../models/Cliente.js";
import Factura from "../models/Factura.js";
import Ticket, { faltanteDe } from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Especie from "../models/Especie.js";
import { noEncontrado } from "../utils/AppError.js";
import { redondearPesos } from "./facturacion.js";
import { diasEntreCompras } from "./visitas.js";
import { evaluarFacturas, resumirCumplimiento, type FacturaEvaluada } from "./metricas/pagosATiempo.js";
import {
  claveMes,
  enPeriodo,
  filtroTickets,
  mesesEntre,
  porcentaje,
  rangoDe,
  type Periodo,
} from "./metricas/comun.js";

/**
 * El perfil de un cliente: cuánto vale y qué tan confiable es.
 *
 *   cumplimiento   cómo paga, mes a mes, y cuántas facturas seguidas cumplió
 *   ranking        en qué puesto queda entre los clientes de la marca
 *   valor          cuánto compró y cuánto pesa en las ventas
 *   especies       qué compra
 *
 * Es para decidir: subirle el límite, avisarle cuando llega la mercadería que
 * compra. Distinto del historial, que es el registro movimiento por
 * movimiento para cobrar. Ver doc/PERFIL_CLIENTE.md.
 *
 * Sin período, toda la historia del cliente: el cumplimiento se juzga con
 * todas sus facturas, no con las de un mes.
 */

/** Cuántas especies distintas se devuelven. */
const ESPECIES_MAXIMAS = 10;

interface VentaPorEspecie {
  _id: Types.ObjectId | null;
  nombre: string | null;
  unidades: number;
  monto: number;
}

/**
 * Cuántas facturas seguidas cumplió al 100%, desde la última hacia atrás.
 *
 * Se ordenan por cuándo se resolvieron: las saldadas por su fecha de pago, y
 * las que todavía deben van primero, porque su historia no terminó. La primera
 * que no llegó a 100 corta la racha.
 */
function rachaEnFecha(facturas: FacturaEvaluada[], ahora: Date): number {
  const resueltaEl = (f: FacturaEvaluada) => (f.pagadaEl ?? (f.resultado === "impaga" ? ahora : f.vence)).getTime();
  const ordenadas = [...facturas].sort((a, b) => resueltaEl(b) - resueltaEl(a));

  let racha = 0;
  for (const f of ordenadas) {
    if (f.resultado !== "a-tiempo") break;
    racha++;
  }
  return racha;
}

export async function perfilCliente(
  marca: Types.ObjectId,
  clienteId: string,
  periodo?: Periodo,
  ahora = new Date()
) {
  const cliente = Types.ObjectId.isValid(clienteId)
    ? await Cliente.findOne({ _id: clienteId, marca })
    : null;
  if (!cliente) throw noEncontrado("Cliente");

  const susTickets = { ...filtroTickets(marca, periodo), cliente: cliente._id };

  const [evaluadas, compras, pagos, deuda, ventasDeLaMarca, comprasPorCliente, especies] = await Promise.all([
    // Las de TODOS los clientes: las suyas salen de acá, y el resto arma el ranking.
    evaluarFacturas(marca, periodo, ahora),
    Ticket.find(susTickets).sort({ fecha: -1 }).select("fecha total pagado").lean(),
    Pago.find({
      marca,
      cliente: cliente._id,
      anulado: { $ne: true },
      ...(periodo && { fecha: enPeriodo(periodo) }),
    })
      .sort({ fecha: -1 })
      .select("fecha monto")
      .lean(),
    Factura.findOne({ marca, cliente: cliente._id, estado: "abierta" }).select("saldo").lean(),
    Ticket.aggregate<{ comprado: number }>([
      { $match: filtroTickets(marca, periodo) },
      { $group: { _id: null, comprado: { $sum: "$total" } } },
    ]),
    // Para desempatar el ranking igual que "mejores clientes".
    Ticket.aggregate<{ _id: Types.ObjectId; comprado: number }>([
      { $match: filtroTickets(marca, periodo) },
      { $group: { _id: "$cliente", comprado: { $sum: "$total" } } },
    ]),
    Ticket.aggregate<VentaPorEspecie>([
      { $match: susTickets },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.especie",
          nombreCopiado: { $last: "$items.especieNombre" },
          unidades: { $sum: "$items.cantidad" },
          monto: { $sum: "$items.subtotal" },
        },
      },
      { $lookup: { from: Especie.collection.name, localField: "_id", foreignField: "_id", as: "actual" } },
      {
        $project: {
          // El nombre de hoy; si la especie ya no está, el que quedó en el ticket.
          nombre: { $ifNull: [{ $arrayElemAt: ["$actual.nombre", 0] }, "$nombreCopiado"] },
          unidades: 1,
          monto: 1,
        },
      },
      { $sort: { unidades: -1, monto: -1 } },
    ]),
  ]);

  // ── Cumplimiento ────────────────────────────────────────────
  const facturasDe = new Map<string, FacturaEvaluada[]>();
  for (const f of evaluadas) {
    const id = String(f.cliente);
    facturasDe.set(id, [...(facturasDe.get(id) ?? []), f]);
  }

  const suyas = facturasDe.get(String(cliente._id)) ?? [];
  const resumen = resumirCumplimiento(suyas);

  // De la primera factura juzgable hasta hoy (o el período, si se pidió), sin
  // huecos: un mes sin vencimientos va igual, en null.
  const porMesDeVencimiento = new Map<string, FacturaEvaluada[]>();
  for (const f of suyas) {
    const mes = claveMes(f.vence);
    porMesDeVencimiento.set(mes, [...(porMesDeVencimiento.get(mes) ?? []), f]);
  }
  const primerMes = [...porMesDeVencimiento.keys()].sort()[0];
  const meses = periodo
    ? mesesEntre(periodo.desde, periodo.hasta)
    : primerMes
      ? mesesEntre(primerMes, claveMes(ahora))
      : [];

  // ── Ranking: contra los que tienen alguna factura juzgable ──
  const compradoPorCliente = new Map(comprasPorCliente.map((c) => [String(c._id), c.comprado]));
  const compiten = [...facturasDe.entries()].map(([id, fs]) => ({
    id,
    cumplimiento: resumirCumplimiento(fs),
    comprado: compradoPorCliente.get(id) ?? 0,
  }));
  // Mismo orden que "mejores clientes": si empatan en cumplimiento, va primero
  // el de más facturas evaluadas, y después el que más compró.
  compiten.sort(
    (a, b) =>
      (b.cumplimiento.cumplimientoPromedio ?? -1) - (a.cumplimiento.cumplimientoPromedio ?? -1) ||
      b.cumplimiento.evaluadas - a.cumplimiento.evaluadas ||
      b.comprado - a.comprado
  );
  const puesto = compiten.findIndex((c) => c.id === String(cliente._id));

  // ── Valor ───────────────────────────────────────────────────
  const sumar = <T>(xs: T[], valor: (x: T) => number) => redondearPesos(xs.reduce((t, x) => t + valor(x), 0));
  const comprado = sumar(compras, (t) => t.total);
  const fiado = sumar(compras, faltanteDe);
  // Ya vienen ordenados por fecha descendente.
  const ultimaCompra = compras[0];
  const ultimoPago = pagos[0];

  const unidadesPropias = especies.reduce((t, e) => t + e.unidades, 0);
  const montoPropio = especies.reduce((t, e) => t + e.monto, 0);

  return {
    cliente: cliente.toJSON(),
    periodo: periodo ? rangoDe(periodo) : null,
    cumplimiento: {
      promedio: resumen.cumplimientoPromedio,
      evaluadas: resumen.evaluadas,
      aTiempo: resumen.aTiempo,
      tarde: resumen.tarde,
      impagas: resumen.impagas,
      rachaEnFecha: rachaEnFecha(suyas, ahora),
      diasPromedioDeAtraso: resumen.diasPromedioDeAtraso,
      porMes: meses.map((mes) => {
        const delMes = resumirCumplimiento(porMesDeVencimiento.get(mes) ?? []);
        return { mes, cumplimientoPromedio: delMes.cumplimientoPromedio, evaluadas: delMes.evaluadas };
      }),
    },
    ranking: {
      /** Null si todavía no tiene ninguna factura para juzgar. */
      posicion: puesto >= 0 ? puesto + 1 : null,
      clientes: compiten.length,
    },
    valor: {
      comprado,
      tickets: compras.length,
      ticketPromedio: compras.length ? redondearPesos(comprado / compras.length) : null,
      fiado,
      porcentajeFiado: porcentaje(fiado, comprado),
      /** Lo que debe hoy. */
      saldo: redondearPesos(deuda?.saldo ?? 0),
      primeraCompra: compras.at(-1)?.fecha ?? null,
      ultimaCompra: ultimaCompra ? { fecha: ultimaCompra.fecha, total: ultimaCompra.total } : null,
      ultimoPago: ultimoPago ? { fecha: ultimoPago.fecha, monto: ultimoPago.monto } : null,
      diasEntreCompras: diasEntreCompras(compras.map((t) => t.fecha)),
      /** Cuánto pesa en las ventas de la marca. */
      porcentajeDeLasVentas: porcentaje(comprado, ventasDeLaMarca[0]?.comprado ?? 0),
    },
    especies: especies.slice(0, ESPECIES_MAXIMAS).map((e) => ({
      // Los ítems viejos sin especie llegan en null: el front los muestra como "Sin especie".
      especie: { _id: e._id ?? null, nombre: e.nombre ?? null },
      unidades: e.unidades,
      monto: redondearPesos(e.monto),
      porcentajeUnidades: porcentaje(e.unidades, unidadesPropias),
      porcentajeMonto: porcentaje(e.monto, montoPropio),
    })),
  };
}
