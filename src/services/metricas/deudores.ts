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
  filtroDeuda,
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
 * Deudores: cuánta plata hay en la calle, y si crece o baja.
 *
 * Deudor es todo el que debe algo, haya vencido o no. Moroso es el deudor cuya
 * factura ya venció, y tiene su propia métrica: un negocio puede no tener
 * ningún moroso y estar fiando cada vez más. Eso se ve acá.
 *
 *   evolucion   cuánta plata había en la calle al final de cada mes (o semana)
 *   datos       la lista de hoy, ordenada por lo que debe o por el atraso
 */

export const ORDENES_DEUDORES = ["saldo", "atraso"] as const;
export type OrdenDeudores = (typeof ORDENES_DEUDORES)[number];

export interface OpcionesDeudores {
  periodo: Periodo;
  agrupar: Agrupacion;
  /** Texto en el nombre o el DNI. Filtra la lista, no la evolución ni el resumen. */
  buscar: string;
  /** Quedó de cuando morosos era una pestaña de acá. Morosos tiene su ruta. */
  soloMorosos: boolean;
  orden: OrdenDeudores;
  paginacion: Paginacion;
}

interface Renglon {
  cliente: { _id: Types.ObjectId; nombre: string; dni: string; telefono?: string } | null;
  saldo: number;
  saldoVencido: number;
  facturas: number;
  facturasVencidas: number;
  vencimientoMasViejo: Date | null;
  diasDeAtraso: number;
  moroso: boolean;
  ultimaCompra: { fecha: Date; total: number } | null;
  ultimoPago: { fecha: Date; monto: number } | null;
  diasSinPagar: number | null;
}

interface Resultado {
  resumen: { deudores: number; morosos: number; deudaTotal: number; deudaVencida: number }[];
  datos: Renglon[];
  total: { n: number }[];
}

/** Cuánta plata había en la calle al final de cada tramo del período. */
async function evolucion(marca: Types.ObjectId, periodo: Periodo, agrupar: Agrupacion, ahora: Date) {
  const tramos = tramosDelPeriodo(periodo, agrupar, ahora);
  // La foto de justo antes de empezar: contra ella se miden los nuevos y la
  // variación del primer tramo.
  const cortes = [periodo.inicio.getTime() - 1, ...tramos.map((t) => t.corte.getTime())];
  const fotos = await fotosDeDeuda(marca, cortes);

  return {
    deudoresAlInicio: fotos[0]!.deudores.size,
    deudaAlInicio: redondearPesos(fotos[0]!.deuda),
    puntos: tramos.map((tramo, k) => {
      const antes = fotos[k]!.deudores;
      const despues = fotos[k + 1]!.deudores;
      return {
        etiqueta: tramo.etiqueta,
        desde: tramo.desde,
        hasta: tramo.hasta,
        deudores: despues.size,
        /** Los que empezaron a deber en este tramo. */
        nuevos: entraron(antes, despues),
        /** Los que terminaron de pagar: debían al final del anterior y ya no. */
        saldaron: salieron(antes, despues),
        deudaTotal: redondearPesos(fotos[k + 1]!.deuda),
        deudaVencida: redondearPesos(fotos[k + 1]!.deudaVencida),
      };
    }),
  };
}

/** Los deudores de hoy, con su deuda y su atraso. */
async function listaDeDeudores(
  marca: Types.ObjectId,
  { buscar, soloMorosos, orden, paginacion }: Omit<OpcionesDeudores, "periodo" | "agrupar">,
  ahora: Date
) {
  // Los filtros achican la lista, no el resumen de arriba: los totales de la
  // marca son los mismos se busque lo que se busque.
  const filtros: Record<string, unknown> = {};
  if (soloMorosos) filtros["moroso"] = true;
  if (buscar) filtros["_id"] = { $in: await clientesQueCoinciden(marca, buscar) };

  const ordenar: Record<string, 1 | -1> =
    orden === "atraso" ? { diasDeAtraso: -1, saldo: -1, _id: 1 } : { saldo: -1, _id: 1 };

  const vencida = { $lt: ["$venceEl", ahora] };

  const [resultado] = await Factura.aggregate<Resultado>([
    { $match: filtroDeuda(marca) },
    {
      $group: {
        _id: "$cliente",
        saldo: { $sum: "$saldo" },
        saldoVencido: { $sum: { $cond: [vencida, "$saldo", 0] } },
        facturas: { $sum: 1 },
        facturasVencidas: { $sum: { $cond: [vencida, 1, 0] } },
        // $min saltea los null: queda el vencimiento más viejo de las vencidas.
        vencimientoMasViejo: { $min: { $cond: [vencida, "$venceEl", null] } },
      },
    },
    {
      $addFields: {
        moroso: { $gt: ["$saldoVencido", 0] },
        diasDeAtraso: {
          $cond: [
            { $eq: ["$vencimientoMasViejo", null] },
            0,
            { $ceil: diasEntre("$vencimientoMasViejo", ahora) },
          ],
        },
      },
    },
    {
      $facet: {
        resumen: [
          {
            $group: {
              _id: null,
              deudores: { $sum: 1 },
              morosos: { $sum: { $cond: ["$moroso", 1, 0] } },
              deudaTotal: { $sum: "$saldo" },
              deudaVencida: { $sum: "$saldoVencido" },
            },
          },
        ],
        datos: [
          { $match: filtros },
          { $sort: ordenar },
          { $skip: saltear(paginacion) },
          { $limit: paginacion.porPagina },
          ultimoDelCliente(Ticket.collection.name, { total: 1 }, "ultimaCompra"),
          ultimoDelCliente(Pago.collection.name, { monto: 1 }, "ultimoPago"),
          ...conCliente(),
          {
            $addFields: {
              ultimaCompra: { $ifNull: [{ $arrayElemAt: ["$ultimaCompra", 0] }, null] },
              ultimoPago: { $ifNull: [{ $arrayElemAt: ["$ultimoPago", 0] }, null] },
            },
          },
          {
            $addFields: {
              diasSinPagar: {
                $cond: [{ $eq: ["$ultimoPago", null] }, null, { $floor: diasEntre("$ultimoPago.fecha", ahora) }],
              },
            },
          },
          { $project: { _id: 0 } },
        ],
        total: [{ $match: filtros }, { $count: "n" }],
      },
    },
  ]);

  return {
    resumen: resultado?.resumen[0],
    datos: (resultado?.datos ?? []).map((r, i) => ({
      posicion: saltear(paginacion) + i + 1,
      ...r,
      saldo: redondearPesos(r.saldo),
      saldoVencido: redondearPesos(r.saldoVencido),
    })),
    total: resultado?.total[0]?.n ?? 0,
  };
}

export async function deudores(marca: Types.ObjectId, opciones: OpcionesDeudores, ahora = new Date()) {
  const { periodo, agrupar, paginacion } = opciones;

  const [historia, lista, clientes] = await Promise.all([
    evolucion(marca, periodo, agrupar, ahora),
    listaDeDeudores(marca, opciones, ahora),
    Cliente.countDocuments({ marca }),
  ]);

  const hoy = lista.resumen?.deudores ?? 0;
  const deudaTotal = redondearPesos(lista.resumen?.deudaTotal ?? 0);
  const deudaVencida = redondearPesos(lista.resumen?.deudaVencida ?? 0);

  // Si el período termina hoy, el último punto es la foto de hoy; si terminó
  // antes, la variación se mide hasta donde llega el período.
  const ultimo = historia.puntos.at(-1);

  return {
    periodo: rangoDe(periodo),
    agrupar,
    resumen: {
      deudores: hoy,
      morosos: lista.resumen?.morosos ?? 0,
      deudaTotal,
      deudaVencida,
      porcentajeVencida: porcentaje(deudaVencida, deudaTotal),

      clientes,
      porcentajeDeClientes: porcentaje(hoy, clientes),
      deudoresAlInicioDelPeriodo: historia.deudoresAlInicio,
      variacionDeDeudores: (ultimo?.deudores ?? historia.deudoresAlInicio) - historia.deudoresAlInicio,
      deudaAlInicioDelPeriodo: historia.deudaAlInicio,
      /** Si es positivo, la libreta creció: se fió más de lo que se cobró. */
      variacionDeDeuda: redondearPesos((ultimo?.deudaTotal ?? historia.deudaAlInicio) - historia.deudaAlInicio),
    },
    evolucion: historia.puntos,
    ...respuestaPaginada(lista.datos, lista.total, paginacion),
  };
}
