import { Router } from "express";
import Cliente from "../models/Cliente.js";
import Factura from "../models/Factura.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { validarVentana, VENTANA_POR_DEFECTO, type VentanaPago } from "../utils/fechas.js";
import { abrirFactura, deudaTotalDe, serializarFactura } from "../services/facturacion.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();
router.use(requireAuth);

/** Lee la ventana de pago del body, validándola. */
function leerVentana(body: Record<string, unknown> | undefined): VentanaPago {
  const cruda = body?.["ventanaPago"] as Partial<VentanaPago> | undefined;
  if (!cruda) return VENTANA_POR_DEFECTO;

  const ventana: VentanaPago = {
    desdeDia: Number(cruda.desdeDia ?? VENTANA_POR_DEFECTO.desdeDia),
    hastaDia: Number(cruda.hastaDia ?? VENTANA_POR_DEFECTO.hastaDia),
  };

  try {
    validarVentana(ventana);
  } catch (e) {
    throw datosInvalidos(e instanceof Error ? e.message : "Ventana de pago inválida");
  }
  return ventana;
}

const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAXIMO = 100;

/** Escapa lo que el usuario tipeó para que no se interprete como regex. */
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Listar clientes, con lo que debe cada uno.
 *
 * Query params:
 *   buscar     texto en el nombre o el DNI
 *   deudores   "true" para ver solo a los que deben
 *   vencidos   "true" para solo los que tienen una factura vencida
 *   pagina     desde 1
 *   porPagina  hasta 100
 *
 * La deuda se calcula en la misma consulta con un $lookup. Antes se hacía un
 * find y después una consulta por cliente para sumar sus facturas: con 200
 * clientes eran 201 viajes a la base.
 */
router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const buscar = typeof req.query["buscar"] === "string" ? req.query["buscar"].trim() : "";
    const soloDeudores = req.query["deudores"] === "true";
    const soloVencidos = req.query["vencidos"] === "true";

    const pagina = Math.max(1, Number(req.query["pagina"]) || 1);
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(req.query["porPagina"]) || POR_PAGINA_DEFECTO)
    );

    const filtro: Record<string, unknown> = { administrador: req.usuario._id };

    if (buscar) {
      const patron = new RegExp(escaparRegex(buscar), "i");
      filtro["$or"] = [{ nombre: patron }, { dni: patron }];
    }

    const ahora = new Date();

    const resultado = await Cliente.aggregate([
      { $match: filtro },
      {
        // Trae la deuda y si tiene alguna factura vencida, en un solo viaje.
        $lookup: {
          from: "facturas",
          let: { clienteId: "$_id" },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$cliente", "$$clienteId"] },
                estado: { $in: ["abierta", "cerrada"] },
                saldo: { $gt: 0 },
              },
            },
            {
              $group: {
                _id: null,
                deuda: { $sum: "$saldo" },
                vencidas: { $sum: { $cond: [{ $lt: ["$venceEl", ahora] }, 1, 0] } },
              },
            },
          ],
          as: "resumen",
        },
      },
      {
        $addFields: {
          deuda: { $ifNull: [{ $arrayElemAt: ["$resumen.deuda", 0] }, 0] },
          facturasVencidas: { $ifNull: [{ $arrayElemAt: ["$resumen.vencidas", 0] }, 0] },
        },
      },
      { $project: { resumen: 0, __v: 0 } },
      ...(soloDeudores ? [{ $match: { deuda: { $gt: 0 } } }] : []),
      ...(soloVencidos ? [{ $match: { facturasVencidas: { $gt: 0 } } }] : []),
      {
        // $facet cuenta el total y trae la página en una sola pasada.
        $facet: {
          datos: [{ $sort: { nombre: 1 } }, { $skip: (pagina - 1) * porPagina }, { $limit: porPagina }],
          total: [{ $count: "n" }],
        },
      },
    ]);

    const datos = resultado[0]?.datos ?? [];
    const total = resultado[0]?.total?.[0]?.n ?? 0;

    res.json({
      datos,
      total,
      pagina,
      porPagina,
      paginas: Math.ceil(total / porPagina),
    });
  })
);

// Un cliente, con su deuda y su factura abierta
router.get(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const cliente = await Cliente.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });
    if (!cliente) throw noEncontrado("Cliente");

    const abierta = await Factura.findOne({ cliente: cliente._id, estado: "abierta" });

    res.json({
      ...cliente.toJSON(),
      deuda: await deudaTotalDe(cliente._id),
      facturaAbierta: abierta ? serializarFactura(abierta) : null,
    });
  })
);

/**
 * Crear cliente.
 *
 * Le abre su primera factura en el mismo paso: el administrador no tiene que
 * acordarse de nada, y el primer ticket que cargue ya tiene dónde ir.
 */
router.post(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const { nombre, dni, telefono, email, direccion, limiteCredito } = req.body ?? {};

    const cliente = await Cliente.create({
      nombre,
      dni,
      telefono,
      email,
      direccion,
      limiteCredito: limiteCredito ?? 0,
      ventanaPago: leerVentana(req.body),
      administrador: req.usuario._id,
    });

    const factura = await abrirFactura(cliente);

    res.status(201).json({ ...cliente.toJSON(), facturaAbierta: serializarFactura(factura) });
  })
);

router.put(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const { nombre, dni, telefono, email, direccion, limiteCredito } = req.body ?? {};

    const cambios: Record<string, unknown> = { nombre, dni, telefono, email, direccion };
    if (limiteCredito !== undefined) cambios["limiteCredito"] = limiteCredito;
    if (req.body?.ventanaPago) cambios["ventanaPago"] = leerVentana(req.body);

    const cliente = await Cliente.findOneAndUpdate(
      { _id: req.params["id"], administrador: req.usuario._id },
      cambios,
      { new: true, runValidators: true }
    );
    if (!cliente) throw noEncontrado("Cliente");
    res.json(cliente);
  })
);

// No hay DELETE de clientes a propósito.
//
// Borrar un cliente se lleva su historial de compras y con él las métricas de
// ese período. Cuando haga falta sacarlo de la lista, va a ser una baja lógica
// (un campo `activo`), no un borrado real.

export default router;
