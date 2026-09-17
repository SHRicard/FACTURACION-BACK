import { Router } from "express";
import Cliente from "../models/Cliente.js";
import Factura from "../models/Factura.js";
import Pago from "../models/Pago.js";
import { conMarca } from "../middleware/marca.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { noEncontrado } from "../utils/AppError.js";
import {
  anularPago,
  leerDatosPago,
  registrarPagoDeCliente,
  registrarPagoDeFactura,
} from "../services/pagos.js";
import type { RequestConMarca } from "../types/index.js";

const router = Router();

// Rutas completas (/clientes/..., /facturas/..., /pagos/...), así que el auth va
// ruta por ruta (`conMarca`): mismo motivo que en tickets.ts.

// ─────────────────────────────────────────────────────────────
// POST /clientes/:id/pagos — "dejó $20.000", se reparte solo
//
// Descuenta de la factura más vieja con saldo y, si sobra, sigue con la
// siguiente. No acepta más de lo que debe en total.
router.post(
  "/clientes/:id/pagos",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const cliente = await Cliente.findOne({ _id: req.params["id"], marca: req.marca._id });
    if (!cliente) throw noEncontrado("Cliente");

    const datos = leerDatosPago(req.body);
    res.status(201).json(await registrarPagoDeCliente(cliente, datos, req.usuario._id));
  })
);

// POST /facturas/:id/pagos — pagar una factura puntual
//
// Todo el monto va a esa factura. No acepta más que su saldo.
router.post(
  "/facturas/:id/pagos",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const factura = await Factura.findOne({ _id: req.params["id"], marca: req.marca._id });
    if (!factura) throw noEncontrado("Factura", "a");

    const datos = leerDatosPago(req.body);
    res.status(201).json(await registrarPagoDeFactura(factura, datos, req.usuario._id));
  })
);

// DELETE /pagos/:id — anular un pago cargado por error
//
// Baja lógica, como el ticket: queda tachado y deja de descontar. Se anula la
// entrega entera, con todas las facturas que tocó.
router.delete(
  "/pagos/:id",
  conMarca,
  asyncHandler<RequestConMarca>(async (req, res) => {
    const pago = await Pago.findOne({ _id: req.params["id"], marca: req.marca._id });
    if (!pago) throw noEncontrado("Pago");

    const motivo = req.body?.motivo ? String(req.body.motivo).trim() : undefined;
    res.json(await anularPago(pago, motivo));
  })
);

export default router;
