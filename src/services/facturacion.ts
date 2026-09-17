import type { Types } from "mongoose";
import Factura, { type FacturaDocument } from "../models/Factura.js";
import Ticket, { faltanteDe } from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Cliente, { type ClienteDocument } from "../models/Cliente.js";
import { estaVencida, finDelDiaEnZona, proximoVencimiento } from "../utils/fechas.js";
import { datosInvalidos } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import { calcularCumplimiento } from "./cumplimiento.js";
import { recalcularMarca } from "./marcas.js";

/**
 * El ciclo de vida de la factura.
 *
 *   abierta ──(un pago la deja en $0)──► pagada
 *      ▲                                   │
 *      └───(se anula ese pago: vuelve a deber)
 *
 * El cliente tiene UNA factura activa (la abierta) a la vez. Todo lo que se
 * lleva se suma ahí, aunque la factura ya haya vencido: vencer no cierra nada,
 * solo dice que no cumplió. La factura se cierra cuando la deuda llega a cero,
 * y recién ahí su próxima compra abre una factura nueva.
 *
 * Al cerrarse queda como registro, con su número y su cumplimiento (ver
 * services/cumplimiento.ts).
 */

/**
 * Redondea a centavos. La plata se suma y resta con floats, y sin esto un saldo
 * que debería dar 0 da 0.0000000001 y la factura nunca queda saldada.
 */
export const redondearPesos = (n: number): number => Math.round(n * 100) / 100;

/**
 * Numera la factura al saldarla. Correlativo por marca: con varios dueños es
 * una sola numeración, la cierre quien la cierre.
 */
async function siguienteNumero(marca: Types.ObjectId): Promise<number> {
  // Se toma el máximo asignado y se le suma uno. El índice único
  // (marca, numero) rechaza un choque si dos cierres coinciden.
  const ultima = await Factura.findOne({ marca, numero: { $ne: null } })
    .sort({ numero: -1 })
    .select("numero");

  return (ultima?.numero ?? 0) + 1;
}

/**
 * Abre una factura vacía para el cliente. El vencimiento es provisorio: el de
 * verdad se fija con el primer ticket (ver fijarVencimiento).
 */
export async function abrirFactura(cliente: ClienteDocument): Promise<FacturaDocument> {
  const ahora = new Date();

  return Factura.create({
    marca: cliente.marca,
    cliente: cliente._id,
    estado: "abierta",
    desde: ahora,
    venceEl: proximoVencimiento(cliente.ventanaPago, ahora),
  });
}

/**
 * La factura activa del cliente. Si no tiene (la anterior se saldó), le abre
 * una nueva: es el único momento en que nace otra factura.
 */
export async function facturaAbiertaDe(cliente: ClienteDocument): Promise<FacturaDocument> {
  const abierta = await Factura.findOne({ cliente: cliente._id, estado: "abierta" });
  if (!abierta) return abrirFactura(cliente);

  // Vacía y con el vencimiento provisorio ya pasado: se lo corre, para que la
  // pantalla no muestre una fecha vieja en una cuenta sin nada.
  if (abierta.cantidadTickets === 0 && estaVencida(abierta.venceEl)) {
    abierta.desde = new Date();
    abierta.venceEl = proximoVencimiento(cliente.ventanaPago);
    await abierta.save();
  }
  return abierta;
}

/**
 * La fecha que el administrador acordó con el cliente, "aaaa-mm-dd". Vence al
 * final de ese día, en hora de Argentina. No puede ser un día que ya pasó:
 * una factura no nace vencida.
 */
export function leerVencimiento(crudo: unknown, ahora = new Date()): Date {
  const texto = typeof crudo === "string" ? crudo.trim() : "";
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  const [anio, mes, dia] = [Number(partes?.[1]), Number(partes?.[2]), Number(partes?.[3])];

  // new Date(2026, 1, 31) no falla: se va al 3 de marzo. Se compara la vuelta.
  const comoUtc = new Date(Date.UTC(anio, mes - 1, dia));
  if (!partes || comoUtc.getUTCMonth() !== mes - 1 || comoUtc.getUTCDate() !== dia) {
    throw datosInvalidos("El vencimiento tiene que ser una fecha aaaa-mm-dd, como 2026-04-10", {
      campo: "venceEl",
    });
  }

  const fecha = finDelDiaEnZona(anio, mes, dia);
  if (fecha < ahora) {
    throw datosInvalidos("El vencimiento no puede ser un día que ya pasó", { campo: "venceEl" });
  }
  return fecha;
}

/**
 * Le pone fecha a la factura con su primer ticket: la que acordó el
 * administrador ("vuelve el 10 de abril") o, si no eligió, la de la ventana de
 * pago del cliente.
 *
 * Esa primera fecha queda guardada aparte (`vencimientoOriginal`): es contra
 * la que se mide el cumplimiento, aunque después se reprograme.
 */
export async function fijarVencimiento(
  factura: FacturaDocument,
  cliente: ClienteDocument,
  elegido?: Date
): Promise<FacturaDocument> {
  const ahora = new Date();
  factura.desde = ahora;
  factura.venceEl = elegido ?? proximoVencimiento(cliente.ventanaPago, ahora);
  factura.vencimientoOriginal = factura.venceEl;
  await factura.save();
  return factura;
}

/**
 * "Te pago el 30": nueva fecha acordada. Cambia cuándo figura vencida, pero
 * no el cumplimiento, que se sigue midiendo contra la fecha original.
 */
export async function reprogramarVencimiento(
  factura: FacturaDocument,
  fecha: Date
): Promise<FacturaDocument> {
  if (factura.estado !== "abierta") {
    throw datosInvalidos(`La factura está ${factura.estado}: ya no se le cambia el vencimiento`, {
      estadoFactura: factura.estado,
    });
  }
  if (factura.cantidadTickets === 0) {
    throw datosInvalidos("La factura todavía no tiene compras: el vencimiento se elige con el primer ticket");
  }

  if (!factura.vencimientoOriginal) factura.vencimientoOriginal = factura.venceEl;
  factura.venceEl = fecha;
  factura.reprogramadaEl = new Date();
  await factura.save();
  return factura;
}

/**
 * Recalcula los totales de una factura sumando sus tickets y pagos.
 *
 * Los totales están guardados para que leer una factura sea una sola consulta,
 * pero se derivan siempre de acá: no hay ningún lugar que los incremente a
 * mano, así que no pueden quedar desfasados.
 */
export async function recalcularFactura(facturaId: Types.ObjectId): Promise<FacturaDocument> {
  const [actual, tickets, pagos] = await Promise.all([
    Factura.findById(facturaId).select("vencimientoOriginal"),
    // Los anulados quedan guardados y se siguen viendo, pero no suman.
    // `$ne: true` y no `false` a propósito: los tickets cargados antes de que
    // existiera la baja lógica no tienen el campo.
    Ticket.find({ factura: facturaId, anulado: { $ne: true } }),
    // Mismo criterio con los pagos anulados.
    Pago.find({ factura: facturaId, anulado: { $ne: true } }),
  ]);

  if (!actual) throw new Error(`La factura ${String(facturaId)} no existe`);

  const totalMercaderia = redondearPesos(tickets.reduce((t, k) => t + k.total, 0));
  const totalPagadoEnTickets = redondearPesos(tickets.reduce((t, k) => t + (k.pagado ?? 0), 0));
  const totalFiado = redondearPesos(tickets.reduce((t, k) => t + faltanteDe(k), 0));
  const totalPagos = redondearPesos(pagos.reduce((t, p) => t + p.monto, 0));

  const ultimoPagoEl = pagos.length
    ? new Date(Math.max(...pagos.map((p) => p.fecha.getTime())))
    : null;

  const factura = await Factura.findByIdAndUpdate(
    facturaId,
    {
      cantidadTickets: tickets.length,
      totalMercaderia,
      totalPagadoEnTickets,
      totalFiado,
      totalPagos,
      cantidadPagos: pagos.length,
      ultimoPagoEl,
      saldo: redondearPesos(totalFiado - totalPagos),
      cumplimiento: calcularCumplimiento(totalFiado, pagos, actual.vencimientoOriginal),
    },
    { new: true }
  );

  if (!factura) throw new Error(`La factura ${String(facturaId)} no existe`);

  // Todo lo que cambia una factura (tickets, pagos, anulaciones) pasa por
  // acá: es el lugar para poner al día lo que mueve la marca.
  await recalcularMarca(factura.marca);
  return factura;
}

/**
 * La factura quedó en cero: se cierra como registro, con su número y su
 * cumplimiento. Desde acá, la próxima compra del cliente abre una nueva.
 */
export async function saldarFactura(factura: FacturaDocument): Promise<FacturaDocument> {
  if (!factura.numero) factura.numero = await siguienteNumero(factura.marca);
  factura.estado = "pagada";
  // El día que terminó de pagar, no el día en que alguien tocó la cuenta.
  factura.pagadaEl = factura.ultimoPagoEl ?? new Date();
  await factura.save();

  logger.info(
    `Factura N°${String(factura.numero).padStart(4, "0")} saldada · cumplimiento ${
      factura.cumplimiento ?? "—"
    }%`
  );
  return factura;
}

/**
 * Antes de que una factura pagada vuelva a deber: el cliente no puede tener
 * dos facturas con deuda. Si ya tiene una nueva con compras, no se puede.
 *
 * Va antes de tocar nada (por ejemplo, antes de anular el pago), así un
 * rechazo no deja cambios a medias.
 */
export async function exigirQueSePuedaReabrir(factura: FacturaDocument): Promise<void> {
  if (factura.estado !== "pagada") return;

  const nueva = await Factura.findOne({
    cliente: factura.cliente,
    estado: "abierta",
    _id: { $ne: factura._id },
  });
  if (nueva && (await Ticket.exists({ factura: nueva._id }))) {
    throw datosInvalidos(
      "No se puede: esta factura ya estaba saldada y el cliente tiene una factura nueva con compras. Un cliente no puede tener dos facturas con deuda.",
      { facturaNueva: nueva._id }
    );
  }
}

/**
 * Una factura pagada vuelve a deber y vuelve a ser la activa. Si mientras
 * tanto se le abrió otra vacía, esa sobra y se borra.
 */
async function reabrirFactura(factura: FacturaDocument): Promise<FacturaDocument> {
  await exigirQueSePuedaReabrir(factura);
  await Factura.deleteMany({ cliente: factura.cliente, estado: "abierta", _id: { $ne: factura._id } });

  factura.estado = "abierta";
  factura.pagadaEl = undefined;
  await factura.save();
  return factura;
}

/**
 * Pone el estado de acuerdo al saldo, después de cualquier cambio.
 *
 *   abierta + un pago la dejó en cero   → pagada
 *   pagada  + vuelve a deber            → abierta   (se anuló el pago que la saldaba)
 *
 * Sin pagos a cuenta no se cierra aunque esté en cero: si todo lo pagó en el
 * mostrador, no hubo deuda que saldar y la factura sigue recibiendo compras.
 */
export async function ajustarEstadoPorSaldo(factura: FacturaDocument): Promise<FacturaDocument> {
  if (factura.estado === "abierta" && factura.saldo <= 0 && factura.totalPagos > 0) {
    return saldarFactura(factura);
  }
  if (factura.estado === "pagada" && factura.saldo > 0) {
    return reabrirFactura(factura);
  }
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
    vencida: estaVencida(factura.venceEl) && factura.saldo > 0 && factura.estado === "abierta",
    diasParaVencer: Math.ceil((factura.venceEl.getTime() - Date.now()) / 86_400_000),
    // Si se le cambió la fecha después del primer ticket.
    reprogramada:
      !!factura.vencimientoOriginal &&
      factura.vencimientoOriginal.getTime() !== factura.venceEl.getTime(),
    // Cuánto de lo fiado ya volvió en pagos: para la barra de progreso.
    porcentajeCobrado:
      factura.totalFiado > 0
        ? Math.min(100, Math.round((factura.totalPagos / factura.totalFiado) * 100))
        : 0,
  };
}

/**
 * Todo lo que va en la pantalla de una factura: el cliente, los tickets y los
 * pagos, con los anulados incluidos para mostrarlos tachados.
 *
 * La usan GET /facturas/:id y GET /clientes/:id/factura-actual: la pantalla es
 * una sola, se llegue por donde se llegue.
 */
export async function detalleFactura(factura: FacturaDocument, cliente?: ClienteDocument) {
  const [clienteDeLaFactura, tickets, pagos] = await Promise.all([
    cliente ?? Cliente.findById(factura.cliente),
    Ticket.find({ factura: factura._id }).sort({ fecha: 1 }),
    // Quién lo cobró, con nombre: en un negocio con más de una persona importa.
    Pago.find({ factura: factura._id }).sort({ fecha: 1 }).populate("registradoPor", "nombre"),
  ]);

  return { cliente: clienteDeLaFactura, factura: serializarFactura(factura), tickets, pagos };
}

/**
 * Lo que un cliente debe en total: el saldo de su factura activa.
 *
 * Se calcula, no se guarda en el cliente: un saldo denormalizado sería un
 * segundo lugar donde vive el mismo número y terminaría desincronizándose.
 */
export async function deudaTotalDe(clienteId: Types.ObjectId): Promise<number> {
  const facturas = await Factura.find({ cliente: clienteId, estado: "abierta" }).select("saldo");
  return facturas.reduce((t, f) => t + f.saldo, 0);
}

/** Facturas vencidas de una marca. Filtra por fecha, sin depender de nadie. */
export async function facturasVencidas(marca: Types.ObjectId) {
  return Factura.find({
    marca,
    estado: "abierta",
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
