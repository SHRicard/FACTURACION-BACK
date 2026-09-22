import mongoose, { type Types } from "mongoose";
import Ticket from "../../models/Ticket.js";
import Especie from "../../models/Especie.js";
import { noEncontrado } from "../../utils/AppError.js";
import { redondearPesos } from "../facturacion.js";
import { filtroTickets, mesDe, mesesDelPeriodo, porcentaje, rangoDe, type Periodo } from "./comun.js";

/**
 * Ventas por especie: cuánto se vende de qué.
 *
 * La especie es la etiqueta que agrupa lo que se escribe a mano en cada
 * ticket ("pantalón de jean", "pantalon cargo"). Acá se suma todo lo de cada
 * una:
 *
 *   ventasPorEspecie   el ranking: cuánto de cada especie
 *   detalleEspecie     una sola: qué artículos, qué talles y mes a mes
 *
 * Cuenta todo lo que se llevaron, se haya pagado o fiado. Sin tickets anulados.
 */

export const ORDENES_ESPECIE = ["unidades", "monto"] as const;
export type OrdenEspecie = (typeof ORDENES_ESPECIE)[number];

/** Lo que se suma de cada renglón del ticket. */
const SUMA = { unidades: { $sum: "$items.cantidad" }, monto: { $sum: "$items.subtotal" } };

interface Grupo {
  _id: Types.ObjectId;
  nombre: string;
  unidades: number;
  monto: number;
}

export async function ventasPorEspecie(marca: Types.ObjectId, periodo: Periodo, orden: OrdenEspecie) {
  const grupos = await Ticket.aggregate<Grupo>([
    { $match: filtroTickets(marca, periodo) },
    { $unwind: "$items" },
    // La copia del nombre que quedó en el ticket, por si la especie ya no existe.
    { $group: { _id: "$items.especie", nombreCopiado: { $last: "$items.especieNombre" }, ...SUMA } },
    { $lookup: { from: Especie.collection.name, localField: "_id", foreignField: "_id", as: "actual" } },
    {
      $project: {
        // El nombre de hoy: si la renombraron, se ve con el nombre nuevo.
        nombre: { $ifNull: [{ $arrayElemAt: ["$actual.nombre", 0] }, "$nombreCopiado"] },
        unidades: 1,
        monto: 1,
      },
    },
  ]);

  grupos.sort((a, b) =>
    orden === "monto" ? b.monto - a.monto || b.unidades - a.unidades : b.unidades - a.unidades || b.monto - a.monto
  );

  const unidades = grupos.reduce((t, g) => t + g.unidades, 0);
  const monto = redondearPesos(grupos.reduce((t, g) => t + g.monto, 0));
  const primera = grupos[0];

  return {
    periodo: rangoDe(periodo),
    orden,
    resumen: {
      unidades,
      monto,
      especies: grupos.length,
      /** La primera del ranking, según `orden`. */
      masVendida: primera
        ? { _id: primera._id, nombre: primera.nombre, unidades: primera.unidades, monto: redondearPesos(primera.monto) }
        : null,
    },
    especies: grupos.map((g, i) => ({
      posicion: i + 1,
      especie: { _id: g._id, nombre: g.nombre },
      unidades: g.unidades,
      monto: redondearPesos(g.monto),
      porcentajeUnidades: porcentaje(g.unidades, unidades),
      porcentajeMonto: porcentaje(g.monto, monto),
    })),
  };
}

interface Suma {
  unidades: number;
  monto: number;
}

interface Detalle {
  total: Suma[];
  especie: (Suma & { tickets: number })[];
  porMes: (Suma & { _id: string })[];
  talles: (Suma & { _id: string })[];
  articulos: (Suma & { nombre: string })[];
}

/** Hasta cuántos artículos distintos se devuelven en el detalle. */
const ARTICULOS_MAXIMOS = 50;

export async function detalleEspecie(marca: Types.ObjectId, especieId: string, periodo: Periodo) {
  const especie = mongoose.isValidObjectId(especieId)
    ? await Especie.findOne({ _id: especieId, marca }).select("nombre")
    : null;
  if (!especie) throw noEncontrado("Especie", "a");

  const deLaEspecie = { $match: { "items.especie": especie._id } };

  const [r] = await Ticket.aggregate<Detalle>([
    { $match: filtroTickets(marca, periodo) },
    { $unwind: "$items" },
    {
      $facet: {
        // Todo lo vendido en el período: para saber qué parte es de esta especie.
        total: [{ $group: { _id: null, ...SUMA } }],
        especie: [
          deLaEspecie,
          { $group: { _id: null, ...SUMA, tickets: { $addToSet: "$_id" } } },
          { $project: { unidades: 1, monto: 1, tickets: { $size: "$tickets" } } },
        ],
        porMes: [deLaEspecie, { $group: { _id: mesDe("$fecha"), ...SUMA } }],
        // "m", " M" y "M" son el mismo talle.
        talles: [
          deLaEspecie,
          { $group: { _id: { $toUpper: { $trim: { input: { $ifNull: ["$items.talle", ""] } } } }, ...SUMA } },
          { $sort: { unidades: -1, monto: -1, _id: 1 } },
        ],
        // El artículo es lo que se escribió a mano: se junta sin mayúsculas ni
        // espacios de más, y se muestra como se escribió la primera vez.
        articulos: [
          deLaEspecie,
          { $sort: { fecha: 1 } },
          {
            $group: {
              _id: { $toLower: { $trim: { input: "$items.nombre" } } },
              nombre: { $first: { $trim: { input: "$items.nombre" } } },
              ...SUMA,
            },
          },
          { $sort: { unidades: -1, monto: -1, _id: 1 } },
          { $limit: ARTICULOS_MAXIMOS },
        ],
      },
    },
  ]);

  const total = r?.total[0] ?? { unidades: 0, monto: 0 };
  const propio = r?.especie[0] ?? { unidades: 0, monto: 0, tickets: 0 };
  const mes = new Map((r?.porMes ?? []).map((m) => [m._id, m]));

  return {
    periodo: rangoDe(periodo),
    especie: { _id: especie._id, nombre: especie.nombre },
    resumen: {
      unidades: propio.unidades,
      monto: redondearPesos(propio.monto),
      /** En cuántos tickets apareció. */
      tickets: propio.tickets,
      /** Qué parte de todo lo vendido en el período es de esta especie. */
      porcentajeUnidades: porcentaje(propio.unidades, total.unidades),
      porcentajeMonto: porcentaje(propio.monto, total.monto),
    },
    porMes: mesesDelPeriodo(periodo).map((m) => ({
      mes: m,
      unidades: mes.get(m)?.unidades ?? 0,
      monto: redondearPesos(mes.get(m)?.monto ?? 0),
    })),
    talles: (r?.talles ?? []).map((t) => ({
      talle: t._id || null,
      unidades: t.unidades,
      monto: redondearPesos(t.monto),
      porcentaje: porcentaje(t.unidades, propio.unidades),
    })),
    articulos: (r?.articulos ?? []).map((a) => ({
      nombre: a.nombre,
      unidades: a.unidades,
      monto: redondearPesos(a.monto),
      porcentaje: porcentaje(a.unidades, propio.unidades),
    })),
  };
}
