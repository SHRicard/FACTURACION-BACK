import type { Types } from "mongoose";
import Factura, { type FacturaDocument } from "../models/Factura.js";
import Ticket, { faltanteDe } from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Cliente, { type ClienteDocument } from "../models/Cliente.js";
import { estaVencida, proximoVencimiento } from "../utils/fechas.js";
import { logger } from "../utils/logger.js";

/**
 * El ciclo de vida de la factura.
 *
 *   abierta ──(vence y tiene tickets)──► cerrada ──(paga)──► pagada
 *      └────(vence y está vacía)────► se renueva, sigue abierta
 *
 * El cliente siempre tiene exactamente una factura abierta: es su cuenta
 * corriente del período. Los tickets se le pegan solos, el administrador no
 * elige a cuál van.
 */

/** Numera la factura al cerrarla. Correlativo por negocio. */
async function siguienteNumero(administrador: Types.ObjectId): Promise<number> {
  // Se toma el máximo asignado y se le suma uno. El índice único
  // (administrador, numero) rechaza un choque si dos cierres coinciden.
  const ultima = await Factura.findOne({ administrador, numero: { $ne: null } })
    .sort({ numero: -1 })
    .select("numero");

  return (ultima?.numero ?? 0) + 1;
}

/** Abre la factura del próximo período para un cliente. */
export async function abrirFactura(cliente: ClienteDocument): Promise<FacturaDocument> {
  const ahora = new Date();

  return Factura.create({
    administrador: cliente.administrador,
    cliente: cliente._id,
    estado: "abierta",
    desde: ahora,
    venceEl: proximoVencimiento(cliente.ventanaPago, ahora),
  });
}

/** Cierra una factura: le asigna número y queda a la espera del pago. */
export async function cerrarFactura(factura: FacturaDocument): Promise<FacturaDocument> {
  factura.numero = await siguienteNumero(factura.administrador);
  factura.estado = "cerrada";
  factura.cerradaEl = new Date();
  await factura.save();

  logger.info(
    `Factura N°${String(factura.numero).padStart(4, "0")} cerrada · saldo $${factura.saldo}`
  );
  return factura;
}

/**
 * Devuelve la factura abierta del cliente, poniéndola al día si hizo falta.
 *
 * Acá está la respuesta al problema del ciclo de 31 días: en vez de un cron que
 * corra a medianoche —que falla si el server estaba caído y después hay que
 * reconciliar— el vencimiento se resuelve la próxima vez que alguien toca la
 * cuenta. Se auto-repara solo.
 */
export async function facturaAbiertaDe(cliente: ClienteDocument): Promise<FacturaDocument> {
  const abierta = await Factura.findOne({ cliente: cliente._id, estado: "abierta" });

  if (!abierta) return abrirFactura(cliente);
  if (!estaVencida(abierta.venceEl)) return abierta;

  // Venció y está vacía: no tiene sentido cerrarla ni gastarle un número.
  // Se le corre el vencimiento al próximo período y sigue siendo la abierta.
  if (abierta.cantidadTickets === 0) {
    abierta.desde = new Date();
    abierta.venceEl = proximoVencimiento(cliente.ventanaPago);
    await abierta.save();
    return abierta;
  }

  // Venció con movimiento: se cierra y se abre la del período siguiente.
  await cerrarFactura(abierta);
  return abrirFactura(cliente);
}

/**
 * Recalcula los totales de una factura sumando sus tickets y pagos.
 *
 * Los totales están guardados para que leer una factura sea una sola consulta,
 * pero se derivan siempre de acá: no hay ningún lugar que los incremente a
 * mano, así que no pueden quedar desfasados.
 */
export async function recalcularFactura(facturaId: Types.ObjectId): Promise<FacturaDocument> {
  const [tickets, pagos] = await Promise.all([
    // Los anulados quedan guardados y se siguen viendo, pero no suman.
    // `$ne: true` y no `false` a propósito: los tickets cargados antes de que
    // existiera la baja lógica no tienen el campo.
    Ticket.find({ factura: facturaId, anulado: { $ne: true } }),
    Pago.find({ factura: facturaId }),
  ]);

  const totalMercaderia = tickets.reduce((t, k) => t + k.total, 0);
  const totalPagadoEnTickets = tickets.reduce((t, k) => t + (k.pagado ?? 0), 0);
  const totalFiado = tickets.reduce((t, k) => t + faltanteDe(k), 0);
  const totalPagos = pagos.reduce((t, p) => t + p.monto, 0);

  const factura = await Factura.findByIdAndUpdate(
    facturaId,
    {
      cantidadTickets: tickets.length,
      totalMercaderia,
      totalPagadoEnTickets,
      totalFiado,
      totalPagos,
      saldo: totalFiado - totalPagos,
    },
    { new: true }
  );

  if (!factura) throw new Error(`La factura ${String(facturaId)} no existe`);
  return factura;
}

/** Estado que ve el usuario: "vencida" no se guarda, se calcula. */
export function estadoVisible(factura: FacturaDocument): string {
  if (factura.estado === "pagada" || factura.estado === "anulada") return factura.estado;
  if (factura.saldo <= 0 && factura.cantidadTickets > 0) return "sin deuda";
  return estaVencida(factura.venceEl) ? "vencida" : factura.estado;
}

/** La factura con los campos derivados que el front necesita. */
export function serializarFactura(factura: FacturaDocument) {
  return {
    ...factura.toJSON(),
    estadoVisible: estadoVisible(factura),
    vencida: estaVencida(factura.venceEl) && factura.saldo > 0 && factura.estado !== "pagada",
    diasParaVencer: Math.ceil((factura.venceEl.getTime() - Date.now()) / 86_400_000),
  };
}

/**
 * Lo que un cliente debe en total: la suma de sus facturas con saldo.
 *
 * Se calcula, no se guarda en el cliente: un saldo denormalizado sería un
 * segundo lugar donde vive el mismo número y terminaría desincronizándose.
 */
export async function deudaTotalDe(clienteId: Types.ObjectId): Promise<number> {
  const facturas = await Factura.find({
    cliente: clienteId,
    estado: { $in: ["abierta", "cerrada"] },
  }).select("saldo");

  return facturas.reduce((t, f) => t + f.saldo, 0);
}

/** Facturas vencidas de un negocio. Filtra por fecha, sin depender de nadie. */
export async function facturasVencidas(administrador: Types.ObjectId) {
  return Factura.find({
    administrador,
    estado: { $in: ["abierta", "cerrada"] },
    venceEl: { $lt: new Date() },
    saldo: { $gt: 0 },
  })
    .populate("cliente", "nombre dni telefono")
    .sort({ venceEl: 1 });
}

/** Se llama al crear el cliente: le deja la primera factura abierta. */
export async function abrirPrimeraFactura(clienteId: Types.ObjectId): Promise<FacturaDocument> {
  const cliente = await Cliente.findById(clienteId);
  if (!cliente) throw new Error("Cliente no encontrado al abrir su primera factura");
  return abrirFactura(cliente);
}
