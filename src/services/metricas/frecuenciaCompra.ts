import type { Types } from "mongoose";
import Ticket from "../../models/Ticket.js";
import {
  DIA_MS,
  conCliente,
  diaDe,
  diasEntre,
  filtroTickets,
  rangoDe,
  respuestaPaginada,
  saltear,
  type Paginacion,
  type Periodo,
} from "./comun.js";

/**
 * Frecuencia de compra: cada cuánto vuelve cada cliente.
 *
 * Se cuentan visitas, no tickets: dos tickets el mismo día son una sola vez
 * que vino. Con las visitas del período:
 *
 *   diasEntreCompras  (última − primera) ÷ (visitas − 1)
 *                     el promedio de los intervalos, que es lo mismo
 *   proximaCompra     última + diasEntreCompras: cuándo debería volver
 *
 * Y de ahí el estado:
 *   al-ritmo        viene como siempre
 *   demorado        pasó más de 1,5 veces su intervalo sin volver
 *   sin-historial   una sola visita: todavía no hay ritmo
 */

/** Cuántas veces su intervalo tiene que pasar para que cuente como demorado. */
export const TOLERANCIA_DEMORA = 1.5;

export const ESTADOS_FRECUENCIA = ["al-ritmo", "demorado", "sin-historial"] as const;
export type EstadoFrecuencia = (typeof ESTADOS_FRECUENCIA)[number];

export const ORDENES_FRECUENCIA = ["frecuencia", "demorados"] as const;
export type OrdenFrecuencia = (typeof ORDENES_FRECUENCIA)[number];

export interface OpcionesFrecuencia {
  periodo: Periodo;
  estado?: EstadoFrecuencia | undefined;
  orden: OrdenFrecuencia;
  paginacion: Paginacion;
}

interface Renglon {
  cliente: { _id: Types.ObjectId; nombre: string; dni: string; telefono?: string } | null;
  visitas: number;
  primeraCompra: Date;
  ultimaCompra: Date;
  diasEntreCompras: number | null;
  diasDesdeUltima: number;
  proximaCompra: Date | null;
  estado: EstadoFrecuencia;
}

interface Resultado {
  resumen: { clientes: number; conHistorial: number; demorados: number; diasEntreCompras: number | null }[];
  datos: Renglon[];
  total: { n: number }[];
}

const unDecimal = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

export async function frecuenciaCompra(
  marca: Types.ObjectId,
  { periodo, estado, orden, paginacion }: OpcionesFrecuencia,
  ahora = new Date()
) {
  const filtros = estado ? { estado } : {};
  const ordenar: Record<string, 1 | -1> =
    orden === "demorados"
      ? { sinHistorial: 1, ritmo: -1, _id: 1 }
      : { sinHistorial: 1, diasEntreCompras: 1, visitas: -1, _id: 1 };

  const [resultado] = await Ticket.aggregate<Resultado>([
    { $match: filtroTickets(marca, periodo) },
    // Una visita por día.
    { $group: { _id: { cliente: "$cliente", dia: diaDe("$fecha") }, fecha: { $min: "$fecha" } } },
    {
      $group: {
        _id: "$_id.cliente",
        visitas: { $sum: 1 },
        primeraCompra: { $min: "$fecha" },
        ultimaCompra: { $max: "$fecha" },
      },
    },
    {
      $addFields: {
        diasEntreCompras: {
          $cond: [
            { $gt: ["$visitas", 1] },
            { $divide: [diasEntre("$primeraCompra", "$ultimaCompra"), { $subtract: ["$visitas", 1] }] },
            null,
          ],
        },
        diasDesdeUltima: { $floor: diasEntre("$ultimaCompra", ahora) },
      },
    },
    {
      $addFields: {
        sinHistorial: { $cond: [{ $eq: ["$diasEntreCompras", null] }, 1, 0] },
        // Cuántos de sus intervalos lleva sin venir: 2 es "el doble de lo normal".
        ritmo: {
          $cond: [
            { $gt: ["$diasEntreCompras", 0] },
            { $divide: ["$diasDesdeUltima", "$diasEntreCompras"] },
            null,
          ],
        },
        proximaCompra: {
          $cond: [
            { $eq: ["$diasEntreCompras", null] },
            null,
            { $add: ["$ultimaCompra", { $multiply: ["$diasEntreCompras", DIA_MS] }] },
          ],
        },
        estado: {
          $switch: {
            branches: [
              { case: { $eq: ["$diasEntreCompras", null] }, then: "sin-historial" },
              {
                case: { $gt: ["$diasDesdeUltima", { $multiply: ["$diasEntreCompras", TOLERANCIA_DEMORA] }] },
                then: "demorado",
              },
            ],
            default: "al-ritmo",
          },
        },
      },
    },
    {
      $facet: {
        resumen: [
          {
            $group: {
              _id: null,
              clientes: { $sum: 1 },
              conHistorial: { $sum: { $subtract: [1, "$sinHistorial"] } },
              demorados: { $sum: { $cond: [{ $eq: ["$estado", "demorado"] }, 1, 0] } },
              // $avg saltea los null: el promedio es de los que tienen ritmo.
              diasEntreCompras: { $avg: "$diasEntreCompras" },
            },
          },
        ],
        datos: [
          { $match: filtros },
          { $sort: ordenar },
          { $skip: saltear(paginacion) },
          { $limit: paginacion.porPagina },
          ...conCliente(),
          { $project: { _id: 0, sinHistorial: 0, ritmo: 0 } },
        ],
        total: [{ $match: filtros }, { $count: "n" }],
      },
    },
  ]);

  const resumen = resultado?.resumen[0];
  const datos = (resultado?.datos ?? []).map((r) => ({ ...r, diasEntreCompras: unDecimal(r.diasEntreCompras) }));

  return {
    periodo: rangoDe(periodo),
    resumen: {
      clientes: resumen?.clientes ?? 0,
      conHistorial: resumen?.conHistorial ?? 0,
      demorados: resumen?.demorados ?? 0,
      diasEntreCompras: unDecimal(resumen?.diasEntreCompras),
    },
    ...respuestaPaginada(datos, resultado?.total[0]?.n ?? 0, paginacion),
  };
}
