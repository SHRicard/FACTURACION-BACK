import { Router } from "express";
import Factura from "../models/Factura.js";
import Ticket from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Cliente from "../models/Cliente.js";
import Producto from "../models/Producto.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import {
  facturaAbiertaDe,
  recalcularFactura,
  serializarFactura,
} from "../services/facturacion.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();

// Este router define rutas completas (/clientes/... y /tickets/...), así que el
// auth va ruta por ruta: con router.use(requireAuth) atraparía toda request que
// no matcheó antes y devolvería 401 en vez del 404 de notFound.

/** Cliente del administrador logueado, o 404. */
async function clientePropio(clienteId: string | undefined, administradorId: unknown) {
  const cliente = await Cliente.findOne({ _id: clienteId, administrador: administradorId });
  if (!cliente) throw noEncontrado("Cliente");
  return cliente;
}

// ─────────────────────────────────────────────────────────────
// GET /clientes/:id/facturas — historial del cliente
router.get(
  "/clientes/:id/facturas",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.usuario._id);
    const facturas = await Factura.find({ cliente: cliente._id }).sort({ createdAt: -1 });
    res.json(facturas.map(serializarFactura));
  })
);

// GET /clientes/:id/factura-actual — la cuenta abierta, con lo que va llevando
router.get(
  "/clientes/:id/factura-actual",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.usuario._id);
    const factura = await facturaAbiertaDe(cliente);

    const [tickets, pagos] = await Promise.all([
      Ticket.find({ factura: factura._id }).sort({ fecha: 1 }),
      Pago.find({ factura: factura._id }).sort({ fecha: 1 }),
    ]);

    res.json({ cliente, factura: serializarFactura(factura), tickets, pagos });
  })
);

// ─────────────────────────────────────────────────────────────
// POST /clientes/:id/tickets — registra una compra fiada
//
// El ticket se pega solo a la factura abierta del cliente. Si esa factura ya
// venció, se cierra y se abre la del período siguiente, sin que nadie tenga
// que acordarse de hacerlo.
router.post(
  "/clientes/:id/tickets",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.usuario._id);
    const items = req.body?.items as { producto: string; cantidad: number }[] | undefined;

    if (!items?.length) throw datosInvalidos("El ticket necesita al menos un producto");

    const factura = await facturaAbiertaDe(cliente);

    const itemsCalculados = [];
    let total = 0;

    for (const item of items) {
      const producto = await Producto.findOne({
        _id: item.producto,
        administrador: req.usuario._id,
      }).populate<{ catalogo: { _id: unknown; nombre: string } }>("catalogo", "nombre");

      if (!producto) throw datosInvalidos(`El producto ${item.producto} no existe`);

      const cantidad = Number(item.cantidad);
      if (!Number.isInteger(cantidad) || cantidad < 1) {
        throw datosInvalidos(`Cantidad inválida para "${producto.nombre}"`);
      }
      if (producto.stock < cantidad) {
        throw datosInvalidos(`No hay stock suficiente de "${producto.nombre}"`, {
          producto: producto.nombre,
          talle: producto.talle,
          stockDisponible: producto.stock,
          cantidadPedida: cantidad,
        });
      }

      const subtotal = producto.precio * cantidad;
      total += subtotal;

      // Se copian nombre, talle y precio: si mañana cambia el precio, el
      // ticket viejo tiene que seguir diciendo lo que costó ese día.
      itemsCalculados.push({
        producto: producto._id,
        catalogo: producto.catalogo._id,
        catalogoNombre: producto.catalogo.nombre,
        nombre: producto.nombre,
        talle: producto.talle,
        cantidad,
        precioUnitario: producto.precio,
        subtotal,
      });

      producto.stock -= cantidad;
      await producto.save();
    }

    // Lo que deja en el momento. Sin esto, se fía todo.
    const pagado = Number(req.body?.pagado ?? 0);
    if (!Number.isFinite(pagado) || pagado < 0) {
      throw datosInvalidos("El monto pagado no puede ser negativo");
    }
    if (pagado > total) {
      throw datosInvalidos("Pagó más de lo que suma el ticket", { totalTicket: total, pagado });
    }

    const ticket = await Ticket.create({
      factura: factura._id,
      cliente: cliente._id,
      administrador: req.usuario._id,
      items: itemsCalculados,
      total,
      pagado,
      registradoPor: req.usuario._id,
    });

    const actualizada = await recalcularFactura(factura._id);

    // Aviso si se pasó del límite, pero no bloquea: la decisión es del dueño.
    const warning =
      cliente.limiteCredito > 0 && actualizada.saldo > cliente.limiteCredito
        ? `${cliente.nombre} superó su límite de $${cliente.limiteCredito}`
        : null;

    if (warning) logger.warn(warning);

    res.status(201).json({ ticket, factura: serializarFactura(actualizada), warning });
  })
);

// POST /clientes/:id/pagos — entrega plata a cuenta
router.post(
  "/clientes/:id/pagos",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const cliente = await clientePropio(req.params["id"], req.usuario._id);

    const monto = Number(req.body?.monto);
    if (!Number.isFinite(monto) || monto <= 0) {
      throw datosInvalidos("El monto del pago tiene que ser mayor a 0");
    }

    // Se imputa a la factura más vieja con saldo: primero se salda lo que se
    // debe hace más tiempo. Si no hay ninguna, va a la abierta del período.
    const conDeuda = await Factura.findOne({
      cliente: cliente._id,
      estado: { $in: ["abierta", "cerrada"] },
      saldo: { $gt: 0 },
    }).sort({ venceEl: 1 });

    const factura = conDeuda ?? (await facturaAbiertaDe(cliente));

    const pago = await Pago.create({
      factura: factura._id,
      cliente: cliente._id,
      administrador: req.usuario._id,
      monto,
      metodoPago: req.body?.metodoPago,
      nota: req.body?.nota,
      registradoPor: req.usuario._id,
    });

    const actualizada = await recalcularFactura(factura._id);

    // Si con este pago quedó en cero y ya estaba cerrada, se da por saldada.
    if (actualizada.estado === "cerrada" && actualizada.saldo <= 0) {
      actualizada.estado = "pagada";
      actualizada.pagadaEl = new Date();
      await actualizada.save();
    }

    res.status(201).json({ pago, factura: serializarFactura(actualizada) });
  })
);

// DELETE /tickets/:id — anula un ticket y devuelve el stock
router.delete(
  "/tickets/:id",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const ticket = await Ticket.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });
    if (!ticket) throw noEncontrado("Ticket");

    const factura = await Factura.findById(ticket.factura);
    if (factura && factura.estado !== "abierta") {
      throw datosInvalidos("No se puede anular un ticket de una factura ya cerrada");
    }

    for (const item of ticket.items) {
      await Producto.findByIdAndUpdate(item.producto, { $inc: { stock: item.cantidad } });
    }

    await ticket.deleteOne();
    const actualizada = await recalcularFactura(ticket.factura);

    res.json({ mensaje: "Ticket anulado", factura: serializarFactura(actualizada) });
  })
);

export default router;
