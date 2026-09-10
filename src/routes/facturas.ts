import { Router } from "express";
import Factura, { ESTADOS_FACTURA, type EstadoFactura } from "../models/Factura.js";
import Ticket from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Cliente from "../models/Cliente.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { cerrarFactura, facturasVencidas, serializarFactura } from "../services/facturacion.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();
router.use(requireAuth);

const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAXIMO = 100;

/** Escapa lo que el usuario tipeó para que no se interprete como regex. */
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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

/**
 * Listar las facturas del negocio.
 *
 * Query params:
 *   estado     abierta | cerrada | pagada | anulada
 *   cliente    _id, para ver las de uno solo
 *   vencidas   "true" para las que pasaron su fecha y siguen con saldo
 *   buscar     texto en el nombre o el DNI del cliente
 *   pagina     desde 1
 *   porPagina  hasta 100
 *
 * Va paginado como el listado de clientes: sin esto crece con cada período de
 * cada cliente, y a los pocos meses la pantalla se trae miles de documentos.
 */
router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const filtro: Record<string, unknown> = { administrador: req.usuario._id };

    const estado = req.query["estado"];
    if (typeof estado === "string" && estado) {
      if (!ESTADOS_FACTURA.includes(estado as EstadoFactura)) {
        throw datosInvalidos(`Estado inválido. Los válidos son: ${ESTADOS_FACTURA.join(", ")}`, {
          estado,
          validos: ESTADOS_FACTURA,
        });
      }
      filtro["estado"] = estado;
    }

    if (typeof req.query["cliente"] === "string") filtro["cliente"] = req.query["cliente"];

    // Vencida no es un estado guardado: es una fecha pasada con saldo.
    if (req.query["vencidas"] === "true") {
      filtro["estado"] = filtro["estado"] ?? { $in: ["abierta", "cerrada"] };
      filtro["venceEl"] = { $lt: new Date() };
      filtro["saldo"] = { $gt: 0 };
    }

    // El texto se busca contra el cliente, que es donde el administrador lo
    // conoce: resolvemos primero qué clientes matchean y filtramos por esos.
    const buscar = typeof req.query["buscar"] === "string" ? req.query["buscar"].trim() : "";
    if (buscar) {
      const patron = new RegExp(escaparRegex(buscar), "i");
      const clientes = await Cliente.find({
        administrador: req.usuario._id,
        $or: [{ nombre: patron }, { dni: patron }],
      }).select("_id");

      filtro["cliente"] = { $in: clientes.map((c) => c._id) };
    }

    const pagina = Math.max(1, Number(req.query["pagina"]) || 1);
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(req.query["porPagina"]) || POR_PAGINA_DEFECTO)
    );

    const [facturas, total] = await Promise.all([
      Factura.find(filtro)
        .populate("cliente", "nombre dni telefono limiteCredito")
        .sort({ createdAt: -1 })
        .skip((pagina - 1) * porPagina)
        .limit(porPagina),
      Factura.countDocuments(filtro),
    ]);

    res.json({
      datos: facturas.map(serializarFactura),
      total,
      pagina,
      porPagina,
      paginas: Math.ceil(total / porPagina) || 1,
    });
  })
);

// GET /facturas/:id — el detalle: la factura, sus tickets, sus pagos y el cliente
//
// Devuelve la misma forma que GET /clientes/:id/factura-actual, así la pantalla
// de la factura es una sola sin importar por dónde se haya llegado.
router.get(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const factura = await Factura.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });

    if (!factura) throw noEncontrado("Factura", "a");

    const [cliente, tickets, pagos] = await Promise.all([
      Cliente.findById(factura.cliente),
      Ticket.find({ factura: factura._id }).sort({ fecha: 1 }),
      Pago.find({ factura: factura._id }).sort({ fecha: 1 }),
    ]);

    res.json({ cliente, factura: serializarFactura(factura), tickets, pagos });
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
    if (!factura) throw noEncontrado("Factura abierta", "a");

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
    if (!factura) throw noEncontrado("Factura", "a");

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
