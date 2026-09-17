import type { Types } from "mongoose";
import Ticket from "../../models/Ticket.js";
import Factura from "../../models/Factura.js";
import Cliente from "../../models/Cliente.js";
import { redondearPesos } from "../facturacion.js";
import { CAMPOS_CLIENTE, FALTANTE, filtroDeuda, filtroTickets, porcentaje, rangoDe, type Periodo } from "./comun.js";
import { evaluarFacturas, resumirCumplimiento, type FacturaEvaluada } from "./pagosATiempo.js";

/**
 * Mejores clientes: los que mejor pagan.
 *
 * El mejor cliente es el de mejor cumplimiento: el promedio del % de
 * cumplimiento de todas sus facturas (ver services/cumplimiento.ts). Sin
 * período, se mira toda su historia.
 *
 * También se puede ordenar por lo que compró, porque no siempre coinciden: el
 * que más se lleva puede ser el que peor paga. Para decidir a quién subirle el
 * límite importan las dos cosas.
 */

export const ORDENES_MEJORES = ["cumplimiento", "compras"] as const;
export type OrdenMejores = (typeof ORDENES_MEJORES)[number];

export const LIMITE_MEJORES_DEFECTO = 10;
export const LIMITE_MEJORES_MAXIMO = 50;

export interface OpcionesMejores {
  /** Sin período: toda la historia. */
  periodo?: Periodo | undefined;
  orden: OrdenMejores;
  limite: number;
}

interface Compras {
  _id: Types.ObjectId;
  comprado: number;
  tickets: number;
  fiado: number;
}

export async function mejoresClientes(
  marca: Types.ObjectId,
  { periodo, orden, limite }: OpcionesMejores,
  ahora = new Date()
) {
  const [compras, evaluadas] = await Promise.all([
    Ticket.aggregate<Compras>([
      { $match: filtroTickets(marca, periodo) },
      {
        $group: {
          _id: "$cliente",
          comprado: { $sum: "$total" },
          tickets: { $sum: 1 },
          fiado: { $sum: FALTANTE },
        },
      },
    ]),
    evaluarFacturas(marca, periodo, ahora),
  ]);

  const comprasDe = new Map(compras.map((c) => [String(c._id), c]));
  const facturasDe = new Map<string, FacturaEvaluada[]>();
  for (const f of evaluadas) {
    const id = String(f.cliente);
    facturasDe.set(id, [...(facturasDe.get(id) ?? []), f]);
  }

  // Compiten los que compraron o tienen alguna factura para juzgar.
  const ids = [...new Set([...comprasDe.keys(), ...facturasDe.keys()])];
  const lista = ids.map((id) => {
    const c = comprasDe.get(id);
    return {
      id,
      comprado: c?.comprado ?? 0,
      tickets: c?.tickets ?? 0,
      fiado: c?.fiado ?? 0,
      cumplimiento: resumirCumplimiento(facturasDe.get(id) ?? []),
    };
  });

  // El que no tiene ninguna factura para juzgar va al final del ranking de
  // cumplimiento: no es buen ni mal pagador, todavía no se sabe.
  type Renglon = (typeof lista)[number];
  const puntaje = (r: Renglon) => r.cumplimiento.cumplimientoPromedio ?? -1;
  const porCumplimiento = (a: Renglon, b: Renglon) =>
    puntaje(b) - puntaje(a) || b.cumplimiento.evaluadas - a.cumplimiento.evaluadas;

  lista.sort((a, b) =>
    orden === "compras"
      ? b.comprado - a.comprado || porCumplimiento(a, b)
      : porCumplimiento(a, b) || b.comprado - a.comprado
  );

  const primeros = lista.slice(0, limite);
  const idsPrimeros = primeros.map((r) => r.id);

  const [clientes, saldos] = await Promise.all([
    Cliente.find({ _id: { $in: idsPrimeros } }).select(CAMPOS_CLIENTE).lean(),
    Factura.aggregate<{ _id: Types.ObjectId; saldo: number }>([
      { $match: filtroDeuda(marca) },
      { $group: { _id: "$cliente", saldo: { $sum: "$saldo" } } },
    ]),
  ]);
  const clientePorId = new Map(clientes.map((c) => [String(c._id), c]));
  const saldoPorId = new Map(saldos.map((s) => [String(s._id), s.saldo]));

  return {
    periodo: periodo ? rangoDe(periodo) : null,
    orden,
    clientes: primeros.map((r, i) => ({
      posicion: i + 1,
      cliente: clientePorId.get(r.id) ?? null,
      cumplimiento: r.cumplimiento,
      comprado: redondearPesos(r.comprado),
      tickets: r.tickets,
      ticketPromedio: r.tickets ? redondearPesos(r.comprado / r.tickets) : null,
      fiado: redondearPesos(r.fiado),
      /** Cuánto de lo que compró se lo llevó fiado. */
      porcentajeFiado: porcentaje(r.fiado, r.comprado),
      /** Lo que debe hoy. */
      saldo: redondearPesos(saldoPorId.get(r.id) ?? 0),
    })),
  };
}
