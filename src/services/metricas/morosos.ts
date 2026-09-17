import type { Types } from "mongoose";
import Factura from "../../models/Factura.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import Cliente from "../../models/Cliente.js";
import { redondearPesos } from "../facturacion.js";
import { entraron, fotosDeDeuda, salieron } from "./evolucionDeuda.js";
import {
  clientesQueCoinciden,
  conCliente,
  diasEntre,
  porcentaje,
  rangoDe,
  respuestaPaginada,
  saltear,
  tramosDelPeriodo,
  ultimoDelCliente,
  type Agrupacion,
  type Paginacion,
  type Periodo,
} from "./comun.js";

/**
 * Morosos: los clientes con su factura vencida y todavía con deuda.
 *
 * Dos partes, para la misma pantalla:
 *
 *   evolucion   cuántos morosos había al final de cada mes (o semana) del
 *               período, cuántos entraron y cuántos salieron
 *   morosos     la lista de hoy, para salir a cobrar
 *
 * La evolución se reconstruye con los tickets y los pagos de cada factura (ver
 * evolucionDeuda.ts). Así cuenta también a los que fueron morosos y después
 * pagaron, que en una foto de hoy ya no aparecen.
 */

export const ORDENES_MOROSOS = ["atraso", "saldo"] as const;
export type OrdenMorosos = (typeof ORDENES_MOROSOS)[number];

export interface OpcionesMorosos {
  periodo: Periodo;
  agrupar: Agrupacion;
  /** Texto en el nombre o el DNI. Filtra la lista, no la evolución ni el resumen. */
  buscar: string;
  orden: OrdenMorosos;
  paginacion: Paginacion;
}

/** Cuántos morosos había al final de cada tramo del período. */
async function evolucion(marca: Types.ObjectId, periodo: Periodo, agrupar: Agrupacion, ahora: Date) {
  const tramos = tramosDelPeriodo(periodo, agrupar, ahora);
  // La foto de justo antes de empezar: contra ella se cuentan los nuevos del
  // primer tramo.
  const cortes = [periodo.inicio.getTime() - 1, ...tramos.map((t) => t.corte.getTime())];
  const fotos = await fotosDeDeuda(marca, cortes);

  return {
    alInicio: fotos[0]!.morosos.size,
    puntos: tramos.map((tramo, k) => {
      const antes = fotos[k]!.morosos;
      const despues = fotos[k + 1]!.morosos;
      return {
        etiqueta: tramo.etiqueta,
        desde: tramo.desde,
        hasta: tramo.hasta,
        morosos: despues.size,
        /** Los que no eran morosos al final del tramo anterior y ahora sí. */
        nuevos: entraron(antes, despues),
        /** Los que eran morosos al final del tramo anterior y ya no. */
        recuperados: salieron(antes, despues),
        montoVencido: redondearPesos(fotos[k + 1]!.deudaVencida),
      };
    }),
  };
}

interface Renglon {
  factura: Types.ObjectId;
  cliente: { _id: Types.ObjectId; nombre: string; dni: string; telefono?: string } | null;
  saldo: number;
  totalFiado: number;
  totalPagos: number;
  cumplimiento: number | null;
  venceEl: Date;
  vencimientoOriginal: Date | null;
  reprogramada: boolean;
  diasDeAtraso: number;
  ultimaCompra: { fecha: Date; total: number } | null;
  ultimoPago: { fecha: Date; monto: number } | null;
  diasSinPagar: number | null;
}

interface ResultadoLista {
  resumen: { morosos: number; montoVencido: number; diasDeAtraso: number }[];
  datos: Renglon[];
  total: { n: number }[];
}

/** Los morosos de hoy: una factura activa vencida con deuda es un cliente moroso. */
async function listaDeMorosos(
  marca: Types.ObjectId,
  { buscar, orden, paginacion }: Pick<OpcionesMorosos, "buscar" | "orden" | "paginacion">,
  ahora: Date
) {
  const filtros = buscar ? { cliente: { $in: await clientesQueCoinciden(marca, buscar) } } : {};
  const ordenar: Record<string, 1 | -1> =
    orden === "saldo" ? { saldo: -1, _id: 1 } : { diasDeAtraso: -1, saldo: -1, _id: 1 };

  const [resultado] = await Factura.aggregate<ResultadoLista>([
    { $match: { marca, estado: "abierta", saldo: { $gt: 0 }, venceEl: { $lt: ahora } } },
    { $addFields: { diasDeAtraso: { $ceil: diasEntre("$venceEl", ahora) } } },
    {
      $facet: {
        resumen: [
          {
            $group: {
              _id: null,
              morosos: { $sum: 1 },
              montoVencido: { $sum: "$saldo" },
              diasDeAtraso: { $avg: "$diasDeAtraso" },
            },
          },
        ],
        datos: [
          { $match: filtros },
          { $sort: ordenar },
          { $skip: saltear(paginacion) },
          { $limit: paginacion.porPagina },
          // Antes de traer el cliente: acá `cliente` todavía es su _id.
          ultimoDelCliente(Ticket.collection.name, { total: 1 }, "ultimaCompra", "$cliente"),
          ultimoDelCliente(Pago.collection.name, { monto: 1 }, "ultimoPago", "$cliente"),
          ...conCliente("$cliente"),
          {
            $addFields: {
              ultimaCompra: { $ifNull: [{ $arrayElemAt: ["$ultimaCompra", 0] }, null] },
              ultimoPago: { $ifNull: [{ $arrayElemAt: ["$ultimoPago", 0] }, null] },
            },
          },
          {
            $project: {
              _id: 0,
              factura: "$_id",
              cliente: 1,
              saldo: 1,
              totalFiado: 1,
              totalPagos: 1,
              cumplimiento: 1,
              venceEl: 1,
              vencimientoOriginal: { $ifNull: ["$vencimientoOriginal", null] },
              reprogramada: { $ne: [{ $ifNull: ["$vencimientoOriginal", "$venceEl"] }, "$venceEl"] },
              diasDeAtraso: 1,
              ultimaCompra: 1,
              ultimoPago: 1,
              diasSinPagar: {
                $cond: [{ $eq: ["$ultimoPago", null] }, null, { $floor: diasEntre("$ultimoPago.fecha", ahora) }],
              },
            },
          },
        ],
        total: [{ $match: filtros }, { $count: "n" }],
      },
    },
  ]);

  return {
    resumen: resultado?.resumen[0],
    datos: (resultado?.datos ?? []).map((r, i) => ({ posicion: saltear(paginacion) + i + 1, ...r })),
    total: resultado?.total[0]?.n ?? 0,
  };
}

export async function morosos(marca: Types.ObjectId, opciones: OpcionesMorosos, ahora = new Date()) {
  const { periodo, agrupar, paginacion } = opciones;

  const [historia, lista, clientes] = await Promise.all([
    evolucion(marca, periodo, agrupar, ahora),
    listaDeMorosos(marca, opciones, ahora),
    Cliente.countDocuments({ marca }),
  ]);

  const hoy = lista.resumen?.morosos ?? 0;
  const alFinal = historia.puntos.at(-1)?.morosos ?? historia.alInicio;

  return {
    periodo: rangoDe(periodo),
    agrupar,
    resumen: {
      /** Los morosos de hoy. */
      morosos: hoy,
      clientes,
      porcentajeDeClientes: porcentaje(hoy, clientes),
      montoVencido: redondearPesos(lista.resumen?.montoVencido ?? 0),
      diasPromedioDeAtraso: lista.resumen ? Math.round(lista.resumen.diasDeAtraso * 10) / 10 : null,
      /** Cuántos había al empezar el período, y cuánto cambió hasta el final. */
      alInicioDelPeriodo: historia.alInicio,
      variacionEnElPeriodo: alFinal - historia.alInicio,
    },
    evolucion: historia.puntos,
    morosos: respuestaPaginada(lista.datos, lista.total, paginacion),
  };
}
