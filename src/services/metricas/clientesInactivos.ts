import type { Types } from "mongoose";
import Factura from "../../models/Factura.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import { redondearPesos } from "../facturacion.js";
import {
  DIA_MS,
  conCliente,
  diasEntre,
  filtroDeuda,
  respuestaPaginada,
  saltear,
  ultimoDelCliente,
  type Paginacion,
} from "./comun.js";

/**
 * Clientes que dejaron de comprar y todavía deben.
 *
 * El caso más peligroso de la libreta: mientras el cliente sigue viniendo, la
 * deuda se va hablando en el mostrador. El que dejó de venir con la cuenta
 * abierta es el que más fácil se pierde.
 *
 * "Dejó de comprar" = su último ticket (sin contar los anulados) es de hace
 * más de `dias` días. Se muestra también su último pago: el que no compra
 * pero sigue pagando no es lo mismo que el que desapareció.
 */

export const DIAS_INACTIVO_POR_DEFECTO = 60;
export const ORDENES_INACTIVOS = ["saldo", "dias"] as const;
export type OrdenInactivos = (typeof ORDENES_INACTIVOS)[number];

export interface OpcionesInactivos {
  dias: number;
  orden: OrdenInactivos;
  paginacion: Paginacion;
}

interface Renglon {
  cliente: { _id: Types.ObjectId; nombre: string; dni: string; telefono?: string } | null;
  saldo: number;
  saldoVencido: number;
  ultimaCompra: { fecha: Date; total: number } | null;
  ultimoPago: { fecha: Date; monto: number } | null;
  diasSinComprar: number | null;
}

interface Resultado {
  resumen: { clientes: number; deuda: number }[];
  datos: Renglon[];
  total: { n: number }[];
}

export async function clientesInactivos(
  marca: Types.ObjectId,
  { dias, orden, paginacion }: OpcionesInactivos,
  ahora = new Date()
) {
  const limite = new Date(ahora.getTime() - dias * DIA_MS);
  const ordenar: Record<string, 1 | -1> =
    orden === "dias" ? { diasSinComprar: -1, saldo: -1, _id: 1 } : { saldo: -1, _id: 1 };

  const [resultado] = await Factura.aggregate<Resultado>([
    // Se arranca por los que deben, que son pocos, y recién ahí se busca su
    // última compra: al revés habría que mirar a todos los clientes.
    { $match: filtroDeuda(marca) },
    {
      $group: {
        _id: "$cliente",
        saldo: { $sum: "$saldo" },
        saldoVencido: { $sum: { $cond: [{ $lt: ["$venceEl", ahora] }, "$saldo", 0] } },
      },
    },
    ultimoDelCliente(Ticket.collection.name, { total: 1 }, "ultimaCompra"),
    ultimoDelCliente(Pago.collection.name, { monto: 1 }, "ultimoPago"),
    {
      $addFields: {
        ultimaCompra: { $ifNull: [{ $arrayElemAt: ["$ultimaCompra", 0] }, null] },
        ultimoPago: { $ifNull: [{ $arrayElemAt: ["$ultimoPago", 0] }, null] },
      },
    },
    { $match: { $or: [{ ultimaCompra: null }, { "ultimaCompra.fecha": { $lt: limite } }] } },
    {
      $addFields: {
        diasSinComprar: {
          $cond: [{ $eq: ["$ultimaCompra", null] }, null, { $floor: diasEntre("$ultimaCompra.fecha", ahora) }],
        },
      },
    },
    {
      $facet: {
        resumen: [{ $group: { _id: null, clientes: { $sum: 1 }, deuda: { $sum: "$saldo" } } }],
        datos: [
          { $sort: ordenar },
          { $skip: saltear(paginacion) },
          { $limit: paginacion.porPagina },
          ...conCliente(),
          { $project: { _id: 0 } },
        ],
        total: [{ $count: "n" }],
      },
    },
  ]);

  const datos = (resultado?.datos ?? []).map((r) => ({
    ...r,
    saldo: redondearPesos(r.saldo),
    saldoVencido: redondearPesos(r.saldoVencido),
  }));

  return {
    dias,
    resumen: {
      clientes: resultado?.resumen[0]?.clientes ?? 0,
      deuda: redondearPesos(resultado?.resumen[0]?.deuda ?? 0),
    },
    ...respuestaPaginada(datos, resultado?.total[0]?.n ?? 0, paginacion),
  };
}
