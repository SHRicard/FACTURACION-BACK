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
  cerrarFactura,
  facturaAbiertaDe,
  facturasVencidas,
  recalcularFactura,
  serializarFactura,
} from "../services/facturacion.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();
router.use(requireAuth);

/** Cliente del administrador logueado, o 404. */
async function clientePropio(clienteId: string | undefined, administradorId: unknown) {
  const cliente = await Cliente.findOne({ _id: clienteId, administrador: administradorId });
  if (!cliente) throw noEncontrado("Cliente");
  return cliente;
}

// ─────────────────────────────────────────────────────────────
// GET /facturas/vencidas — las que pasaron su fecha y siguen con saldo
//
// Va antes de /facturas/:id, si no "vencidas" se tomaría como un id.
router.get(
  "/vencidas",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const facturas = await facturasVencidas(req.usuario._id);
    res.json(facturas.map(serializarFactura));
  })
);

// GET /facturas?estado= — todas las del negocio
router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const filtro: Record<string, unknown> = { administrador: req.usuario._id };
    if (typeof req.query["estado"] === "string") filtro["estado"] = req.query["estado"];

    const facturas = await Factura.find(filtro)
      .populate("cliente", "nombre dni telefono")
      .sort({ createdAt: -1 });

    res.json(facturas.map(serializarFactura));
  })
);

// GET /facturas/:id — el detalle, con sus tickets y pagos
router.get(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const factura = await Factura.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
    }).populate("cliente");

    if (!factura) throw noEncontrado("Factura");

    const [tickets, pagos] = await Promise.all([
      Ticket.find({ factura: factura._id }).sort({ fecha: 1 }),
      Pago.find({ factura: factura._id }).sort({ fecha: 1 }),
    ]);

    res.json({ factura: serializarFactura(factura), tickets, pagos });
  })
);

// ─────────────────────────────────────────────────────────────
// POST /facturas/:id/cerrar — cerrarla antes de que venza
router.post(
  "/:id/cerrar",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const factura = await Factura.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
      estado: "abierta",
    });
    if (!factura) throw noEncontrado("Factura abierta");

    if (factura.cantidadTickets === 0) {
      throw datosInvalidos("No se puede cerrar una factura sin tickets");
    }

    await cerrarFactura(factura);
    res.json(serializarFactura(factura));
  })
);

// PUT /facturas/:id/pagada — se saldó
router.put(
  "/:id/pagada",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const factura = await Factura.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
      estado: { $in: ["abierta", "cerrada"] },
    });
    if (!factura) throw noEncontrado("Factura");

    if (factura.saldo > 0) {
      throw datosInvalidos(
        `Todavía queda saldo. Registrá un pago de $${factura.saldo} para saldarla.`,
        { saldo: factura.saldo }
      );
    }

    factura.estado = "pagada";
    factura.pagadaEl = new Date();
    if (!factura.numero) await cerrarFactura(factura);
    await factura.save();

    res.json(serializarFactura(factura));
  })
);

export default router;
