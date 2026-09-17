import { Router } from "express";
import mongoose from "mongoose";
import Factura, { type FacturaDocument } from "../models/Factura.js";
import Ticket, { type TicketDocument } from "../models/Ticket.js";
import Cliente, { type ClienteDocument } from "../models/Cliente.js";
import Especie from "../models/Especie.js";
import { conMarca } from "../middleware/marca.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import {
  ajustarEstadoPorSaldo,
  detalleFactura,
  facturaAbiertaDe,
  fijarVencimiento,
  leerVencimiento,
  recalcularFactura,
  serializarFactura,
} from "../services/facturacion.js";
import { generarPdfFactura } from "../services/pdfFactura.js";
import { enviarPdf } from "../utils/respuestaPdf.js";
import type { RequestConMarca } from "../types/index.js";

const router = Router();

// Este router define rutas completas (/clientes/... y /tickets/...), así que el
// auth va ruta por ruta (`conMarca` = requireAuth + requireMarca): con
// router.use atraparía toda request que no matcheó antes y devolvería 401 en
// vez del 404 de notFound.

/** Cliente de la marca, o 404. */
async function clientePropio(clienteId: string | undefined, marcaId: unknown) {
  const cliente = await Cliente.findOne({ _id: clienteId, marca: marcaId });
  if (!cliente) throw noEncontrado("Cliente");
  return cliente;
}

/** Un renglón tal como lo manda el front. Nada de esto se guarda sin validar. */
interface ItemEntrada {
  nombre?: string;
  talle?: string;
  especie?: string;
  cantidad?: number | string;
  precioUnitario?: number | string;
}

/**
 * Las especies que nombra el ticket, en una sola consulta y ya filtradas por
 * marca: así una especie de otra marca no entra ni por error.
 *
 * Los ids mal formados se descartan acá en vez de dejarlos llegar al $in, que
 * respondería un CastError genérico en lugar de decir qué renglón falla.
 */
async function especiesDelTicket(items: ItemEntrada[], marcaId: unknown) {
  const ids = [
    ...new Set(
      items
        .map((item) => String(item?.especie ?? ""))
        .filter((id) => mongoose.isValidObjectId(id))
    ),
  ];

  const especies = await Especie.find({ _id: { $in: ids }, marca: marcaId });
  return new Map(especies.map((especie) => [String(especie._id), especie]));
}

/**
 * Valida los renglones y los deja listos para guardar, con su total.
 *
 * La usan el alta y la edición: si la validación viviera en cada handler,
 * editar un ticket podría terminar aceptando algo que el alta rechaza.
 *
 * No toca la base: o devuelve todo bien, o tira. Por eso un ticket con un
 * renglón inválido no deja nada a medias.
 */
async function construirItems(items: ItemEntrada[] | undefined, marcaId: unknown) {
  if (!items?.length) throw datosInvalidos("El ticket necesita al menos un ítem");

  // Las especies se traen todas juntas: son pocas y así no se hace una
  // consulta por renglón del ticket.
  const especies = await especiesDelTicket(items, marcaId);

  const itemsCalculados = [];
  let total = 0;

  for (const [indice, item] of items.entries()) {
    // El renglón se nombra por su posición: el front todavía no tiene un
    // nombre válido que mostrar cuando justamente falta el nombre.
    const renglon = `El ítem ${indice + 1}`;

    const nombre = String(item?.nombre ?? "").trim();
    if (!nombre) throw datosInvalidos(`${renglon} necesita un nombre`);

    const especie = especies.get(String(item?.especie ?? ""));
    if (!especie) throw datosInvalidos(`${renglon} necesita una especie de tu lista`);

    const cantidad = Number(item?.cantidad ?? 1);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw datosInvalidos(`Cantidad inválida en "${nombre}"`);
    }

    const precioUnitario = Number(item?.precioUnitario);
    if (!Number.isFinite(precioUnitario) || precioUnitario < 0) {
      throw datosInvalidos(`Precio inválido en "${nombre}"`);
    }

    const subtotal = precioUnitario * cantidad;
    total += subtotal;

    // Nombre, talle, precio y especie quedan congelados en el ticket: es lo
    // que se llevó ese día, al precio de ese día.
    itemsCalculados.push({
      nombre,
      talle: item?.talle ? String(item.talle).trim() : undefined,
      especie: especie._id,
      especieNombre: especie.nombre,
      cantidad,
      precioUnitario,
      subtotal,
    });
  }

  return { items: itemsCalculados, total };
}

/**
 * Aviso de límite de crédito. Avisa, no bloquea: la mercadería ya salió del
 * local y la decisión es del dueño. Mismo criterio que el resto del sistema.
 */
function avisoDeLimite(cliente: ClienteDocument, factura: FacturaDocument): string | null {
  if (cliente.limiteCredito <= 0 || factura.saldo <= cliente.limiteCredito) return null;

  const aviso = `${cliente.nombre} superó su límite de $${cliente.limiteCredito}`;
  logger.warn(aviso);
  return aviso;
}

/** Lo que deja en el momento. Sin esto, se fía todo. */
function leerPagado(crudo: unknown, total: number): number {
  const pagado = Number(crudo ?? 0);
  if (!Number.isFinite(pagado) || pagado < 0) {
    throw datosInvalidos("El monto pagado no puede ser negativo");
  }
  if (pagado > total) {
    throw datosInvalidos("Pagó más de lo que suma el ticket", { totalTicket: total, pagado });
  }
  return pagado;
}

/**
 * Un ticket de la marca, o 404.
 *
 * Los anulados siguen siendo visibles —el historial no se esconde—, pero no se
 * pueden volver a tocar: eso lo chequea cada handler.
 */
async function ticketPropio(ticketId: string | undefined, marcaId: unknown) {
  const ticket = await Ticket.findOne({ _id: ticketId, marca: marcaId });
  if (!ticket) throw noEncontrado("Ticket");
  return ticket;
}

/**
 * Un ticket solo se puede editar o anular mientras su factura sigue abierta.
 *
 * Una vez saldada ya tiene número y cumplimiento: cambiarle los renglones por
 * atrás reescribiría un registro que ya quedó cerrado.
 */
async function exigirFacturaAbierta(ticket: TicketDocument) {
  if (ticket.anulado) {
    throw datosInvalidos("El ticket ya está anulado");
  }

  const factura = await Factura.findById(ticket.factura);
  if (factura && factura.estado !== "abierta") {
    throw datosInvalidos(
      `No se puede modificar un ticket de una factura ${factura.estado}`,
      { estadoFactura: factura.estado }
    );
  }
  return factura;
}

// ─────────────────────────────────────────────────────────────
// GET /clientes/:id/facturas — historial del cliente
router.get(
  "/clientes/:id/facturas",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.marca._id);
    const facturas = await Factura.find({ cliente: cliente._id }).sort({ createdAt: -1 });
    res.json(facturas.map(serializarFactura));
  })
);

// GET /clientes/:id/factura-actual — la factura activa, con lo que va llevando
router.get(
  "/clientes/:id/factura-actual",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.marca._id);
    const factura = await facturaAbiertaDe(cliente);
    res.json(await detalleFactura(factura, cliente));
  })
);

// GET /clientes/:id/factura-actual/pdf — la factura activa, en PDF
//
// Para mandar una factura puntual (por ejemplo una ya saldada, como
// comprobante) está GET /facturas/:id/pdf.
router.get(
  "/clientes/:id/factura-actual/pdf",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.marca._id);
    const factura = await facturaAbiertaDe(cliente);
    const { buffer, nombreArchivo } = await generarPdfFactura(factura, { cliente });

    enviarPdf(res, {
      buffer,
      nombreArchivo,
      disposicion: req.query["inline"] === "1" ? "inline" : "attachment",
    });
  })
);

// ─────────────────────────────────────────────────────────────
// POST /clientes/:id/tickets — registra una compra fiada
//
// Los ítems se escriben acá, no salen de un inventario: nombre, talle, precio
// del día y la especie elegida de la lista de la marca. Lo único que tiene que
// existir de antemano es la especie.
//
// El ticket se pega solo a la factura activa del cliente, aunque ya esté
// vencida: se le permite llevar más, y se suma a lo que debe. Solo cuando la
// deuda llega a cero la factura se cierra y la próxima compra abre otra.
//
// `venceEl` (aaaa-mm-dd, opcional) es la fecha que acordó con el cliente. Vale
// solo en el primer ticket de la factura, que es cuando se fija; sin eso, sale
// de su ventana de pago. Para cambiarla después: PUT /facturas/:id/vencimiento.
router.post(
  "/clientes/:id/tickets",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.marca._id);

    const { items, total } = await construirItems(
      req.body?.items as ItemEntrada[] | undefined,
      req.marca._id
    );
    const pagado = leerPagado(req.body?.pagado, total);
    const vencimientoElegido = req.body?.venceEl ? leerVencimiento(req.body.venceEl) : undefined;

    const factura = await facturaAbiertaDe(cliente);
    if (factura.cantidadTickets === 0) await fijarVencimiento(factura, cliente, vencimientoElegido);

    const ticket = await Ticket.create({
      factura: factura._id,
      cliente: cliente._id,
      marca: req.marca._id,
      items,
      total,
      pagado,
      // Con varios dueños, esto dice cuál de todos lo cargó.
      registradoPor: req.usuario._id,
    });

    const actualizada = await recalcularFactura(factura._id);

    res.status(201).json({
      ticket,
      factura: serializarFactura(actualizada),
      warning: avisoDeLimite(cliente, actualizada),
    });
  })
);

// GET /tickets/:id — uno solo, para abrirlo o editarlo
router.get(
  "/tickets/:id",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const ticket = await ticketPropio(req.params["id"], req.marca._id);
    res.json(ticket);
  })
);

// PUT /tickets/:id — corregir un ticket ya cargado
//
// Reemplaza los renglones completos, no los parchea de a uno: el front ya
// tiene el ticket entero en el formulario, y un merge por índice haría que
// borrar el segundo renglón dependa de mandar bien los otros.
router.put(
  "/tickets/:id",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const ticket = await ticketPropio(req.params["id"], req.marca._id);
    await exigirFacturaAbierta(ticket);

    const { items, total } = await construirItems(
      req.body?.items as ItemEntrada[] | undefined,
      req.marca._id
    );

    // Si no mandan `pagado`, se conserva el que tenía; pero si el ticket se
    // achicó por debajo de eso, dejarlo pasar guardaría un ticket donde dejó
    // más de lo que se llevó.
    const pagado = leerPagado(req.body?.pagado ?? ticket.pagado, total);

    ticket.set({ items, total, pagado });
    await ticket.save();

    const cliente = await Cliente.findById(ticket.cliente);
    // Achicar un ticket puede dejarla en cero si ya había pagos: ahí se salda.
    const actualizada = await ajustarEstadoPorSaldo(await recalcularFactura(ticket.factura));

    res.json({
      ticket,
      factura: serializarFactura(actualizada),
      warning: cliente ? avisoDeLimite(cliente, actualizada) : null,
    });
  })
);

// Los pagos a cuenta están en routes/pagos.ts.

// DELETE /tickets/:id — anula un ticket cargado por error
//
// Baja lógica: el ticket queda guardado con `anulado: true` y deja de sumar a
// la factura. No se borra de verdad porque es un renglón de la libreta —
// tacharlo explica por qué la cuenta del cliente cambió; borrarlo, no.
router.delete(
  "/tickets/:id",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const ticket = await ticketPropio(req.params["id"], req.marca._id);
    await exigirFacturaAbierta(ticket);

    ticket.anulado = true;
    ticket.anuladoEl = new Date();
    if (req.body?.motivo) ticket.motivoAnulacion = String(req.body.motivo).trim();
    await ticket.save();

    const actualizada = await ajustarEstadoPorSaldo(await recalcularFactura(ticket.factura));

    res.json({
      mensaje: "Ticket anulado",
      ticket,
      factura: serializarFactura(actualizada),
    });
  })
);

export default router;
