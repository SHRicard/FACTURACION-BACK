import type { Types } from "mongoose";
import Marca, { type MarcaDocument } from "../../models/Marca.js";
import Cliente from "../../models/Cliente.js";
import Especie from "../../models/Especie.js";
import Factura from "../../models/Factura.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import { leerDatosMarca, marcaConDuenos, recalcularMarca, sacarDueno, sumarDueno } from "../marcas.js";
import { noEncontrado } from "../../utils/AppError.js";
import {
  leerOpcion,
  leerPaginacion,
  leerTexto,
  respuestaPaginada,
  saltear,
  type Query,
} from "../../utils/consulta.js";
import { patronDeTexto } from "../../utils/validaciones.js";
import { logger } from "../../utils/logger.js";
import { exigirId, haceDias } from "./comun.js";

/**
 * Las marcas, vistas por el super_admin. Los números de cada marca salen de
 * `marca.estadisticas`, que se recalcula en cada cambio: acá no se suma nada
 * a mano. Lo que no está guardado (la última actividad, los conteos) se
 * calcula al pedirlo.
 */

const CAMPOS_DUENO = "nombre email dni avatar ultimoAcceso suspendida";

const ORDENES_MARCAS = ["nombre", "recientes", "vendido", "cobrado", "deuda", "clientes"] as const;
const SORT_MARCAS = {
  nombre: { nombre: 1 },
  recientes: { createdAt: -1 },
  vendido: { "estadisticas.totalVendido": -1 },
  cobrado: { "estadisticas.totalCobrado": -1 },
  deuda: { "estadisticas.deudaPendiente": -1 },
  clientes: { "estadisticas.cantidadClientes": -1 },
} as const;

const ACTIVIDADES = ["activas", "inactivas"] as const;
/** Una marca está activa si cargó un ticket o un pago en estos días. */
export const DIAS_MARCA_ACTIVA = 30;

/** Las marcas que cargaron algo desde `desde`. */
export async function marcasConActividad(desde: Date): Promise<Types.ObjectId[]> {
  const [conTickets, conPagos] = await Promise.all([
    Ticket.distinct("marca", { createdAt: { $gte: desde } }),
    Pago.distinct("marca", { createdAt: { $gte: desde } }),
  ]);
  const unicas = new Map<string, Types.ObjectId>();
  for (const id of [...conTickets, ...conPagos] as Types.ObjectId[]) unicas.set(String(id), id);
  return [...unicas.values()];
}

/** Lo último que cargó cada marca (ticket o pago), para una página de marcas. */
async function ultimaActividadDe(ids: Types.ObjectId[]): Promise<Map<string, Date>> {
  const agrupar = [
    { $match: { marca: { $in: ids } } },
    { $group: { _id: "$marca", ultima: { $max: "$createdAt" } } },
  ];
  const [tickets, pagos] = await Promise.all([
    Ticket.aggregate<{ _id: Types.ObjectId; ultima: Date }>(agrupar),
    Pago.aggregate<{ _id: Types.ObjectId; ultima: Date }>(agrupar),
  ]);

  const ultima = new Map<string, Date>();
  for (const { _id, ultima: fecha } of [...tickets, ...pagos]) {
    const actual = ultima.get(String(_id));
    if (!actual || fecha > actual) ultima.set(String(_id), fecha);
  }
  return ultima;
}

/**
 * GET /admin/marcas
 *
 * Query: buscar (nombre), orden, actividad (activas | inactivas en los
 * últimos 30 días), pagina, porPagina.
 */
export async function listarMarcas(query: Query) {
  const paginacion = leerPaginacion(query);
  const orden = leerOpcion(query, "orden", ORDENES_MARCAS, "nombre");
  const actividad = leerOpcion(query, "actividad", ACTIVIDADES);
  const buscar = leerTexto(query, "buscar");

  const filtro: Record<string, unknown> = {};
  if (buscar) filtro["nombre"] = patronDeTexto(buscar);
  if (actividad) {
    const activas = await marcasConActividad(haceDias(DIAS_MARCA_ACTIVA));
    filtro["_id"] = actividad === "activas" ? { $in: activas } : { $nin: activas };
  }

  const [marcas, total] = await Promise.all([
    Marca.find(filtro)
      .populate({ path: "duenos", select: CAMPOS_DUENO })
      .sort({ ...SORT_MARCAS[orden], _id: 1 })
      .skip(saltear(paginacion))
      .limit(paginacion.porPagina),
    Marca.countDocuments(filtro),
  ]);

  const ultima = await ultimaActividadDe(marcas.map((m) => m._id));
  const datos = marcas.map((marca) => ({
    ...marca.toJSON(),
    ultimaActividad: ultima.get(String(marca._id)) ?? null,
  }));

  return respuestaPaginada(datos, total, paginacion);
}

async function buscarMarca(id: unknown): Promise<MarcaDocument> {
  const marca = await Marca.findById(exigirId(id, "Marca", "a"));
  if (!marca) throw noEncontrado("Marca", "a");
  return marca;
}

/** Cuántos hay de cada estado, con cero para los que no aparecen. */
function contarPorEstado<T extends string>(filas: { _id: T; cantidad: number }[], estados: readonly T[]) {
  const conteo = Object.fromEntries(estados.map((e) => [e, 0])) as Record<T, number>;
  for (const { _id, cantidad } of filas) if (_id in conteo) conteo[_id] = cantidad;
  return conteo;
}

/**
 * GET /admin/marcas/:id — la marca con sus dueños, sus números y cuánto se usa.
 */
export async function detalleMarca(id: unknown) {
  const { _id: marcaId } = await buscarMarca(id);
  const ahora = new Date();
  const desde30 = haceDias(30, ahora);
  const activos = { marca: marcaId, anulado: { $ne: true } };

  const [
    marca,
    clientes,
    especies,
    facturasPorEstado,
    facturasVencidas,
    tickets,
    ticketsAnulados,
    tickets30d,
    pagos,
    pagosAnulados,
    pagos30d,
    ultimoTicket,
    ultimoPago,
  ] = await Promise.all([
    Marca.findById(marcaId)
      .populate({ path: "duenos", select: CAMPOS_DUENO })
      .populate({ path: "creadaPor", select: "nombre email" }),
    Cliente.countDocuments({ marca: marcaId }),
    Especie.countDocuments({ marca: marcaId }),
    Factura.aggregate<{ _id: "abierta" | "pagada" | "anulada"; cantidad: number }>([
      { $match: { marca: marcaId } },
      { $group: { _id: "$estado", cantidad: { $sum: 1 } } },
    ]),
    Factura.countDocuments({ marca: marcaId, estado: "abierta", saldo: { $gt: 0 }, venceEl: { $lt: ahora } }),
    Ticket.countDocuments(activos),
    Ticket.countDocuments({ marca: marcaId, anulado: true }),
    Ticket.countDocuments({ ...activos, createdAt: { $gte: desde30 } }),
    Pago.countDocuments(activos),
    Pago.countDocuments({ marca: marcaId, anulado: true }),
    Pago.countDocuments({ ...activos, createdAt: { $gte: desde30 } }),
    Ticket.findOne({ marca: marcaId }).sort({ createdAt: -1 }).select("createdAt"),
    Pago.findOne({ marca: marcaId }).sort({ createdAt: -1 }).select("createdAt"),
  ]);

  const ultimas = [ultimoTicket?.createdAt, ultimoPago?.createdAt].filter((f): f is Date => Boolean(f));
  const ultimaActividad = ultimas.length ? new Date(Math.max(...ultimas.map((f) => f.getTime()))) : null;

  return {
    marca,
    uso: {
      clientes,
      especies,
      facturas: { ...contarPorEstado(facturasPorEstado, ["abierta", "pagada", "anulada"] as const), vencidas: facturasVencidas },
      tickets: { total: tickets, anulados: ticketsAnulados, ultimos30d: tickets30d },
      pagos: { total: pagos, anulados: pagosAnulados, ultimos30d: pagos30d },
      ultimaActividad,
      activa: ultimaActividad !== null && ultimaActividad >= haceDias(DIAS_MARCA_ACTIVA, ahora),
    },
  };
}

/**
 * PUT /admin/marcas/:id — corregir los textos y colores de una marca. Mismas
 * reglas que PUT /marcas/mia: el nombre es obligatorio y el logo no se toca.
 */
export async function editarMarca(id: unknown, body: Record<string, unknown> | undefined) {
  const marca = await buscarMarca(id);
  const { $set, $unset } = leerDatosMarca(body);
  await Marca.updateOne(
    { _id: marca._id },
    { $set, ...(Object.keys($unset).length > 0 && { $unset }) },
    { runValidators: true }
  );
  logger.info(`[admin] marca editada: ${marca.nombre}`);
  return detalleMarca(marca._id);
}

/** POST /admin/marcas/:id/duenos   { dni } — mismas reglas que el dueño. */
export async function sumarDuenoComoAdmin(id: unknown, dni: unknown) {
  const marca = await buscarMarca(id);
  await sumarDueno(marca, dni);
  return detalleMarca(marca._id);
}

/** DELETE /admin/marcas/:id/duenos/:usuarioId — la marca nunca queda sin dueños. */
export async function sacarDuenoComoAdmin(id: unknown, usuarioId: string) {
  const marca = await buscarMarca(id);
  await sacarDueno(marca, usuarioId);
  return detalleMarca(marca._id);
}

/** POST /admin/marcas/:id/recalcular — vuelve a sumar las estadísticas desde cero. */
export async function recalcularUna(id: unknown) {
  const marca = await buscarMarca(id);
  await recalcularMarca(marca._id);
  return marcaConDuenos(marca._id);
}

/**
 * POST /admin/marcas/recalcular — todas, de a una. Para después de un arreglo
 * de datos a mano o si los números de alguna marca no cierran.
 */
export async function recalcularTodas() {
  const inicio = Date.now();
  const ids = await Marca.find().distinct("_id");
  const fallidas: string[] = [];

  for (const id of ids) {
    try {
      await recalcularMarca(id);
    } catch (error) {
      logger.error(error);
      fallidas.push(String(id));
    }
  }

  logger.info(`[admin] estadísticas recalculadas: ${ids.length - fallidas.length}/${ids.length} marcas`);
  return { recalculadas: ids.length - fallidas.length, fallidas, milisegundos: Date.now() - inicio };
}
