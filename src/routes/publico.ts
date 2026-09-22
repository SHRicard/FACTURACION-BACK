import { Router, type Response } from "express";
import mongoose from "mongoose";
import Factura from "../models/Factura.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { enviarPdf } from "../utils/respuestaPdf.js";
import { verificarEnlace } from "../services/enlacesFactura.js";
import { generarPdfFactura } from "../services/pdfFactura.js";

// Rutas SIN login: las abre el cliente desde el link que le llegó por WhatsApp.
const router = Router();

// Lo ve el cliente en el navegador del celular, no el front: va en HTML.
const LINK_NO_DISPONIBLE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Link no disponible</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
           background: #f4f0f8; color: #1f1626;
           font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    main { max-width: 360px; background: #fff; border: 1px solid #e8ddf0; border-radius: 14px; padding: 28px; }
    h1 { margin: 0 0 10px; font-size: 20px; color: #4a1866; }
    p { margin: 0; line-height: 1.5; color: #5b5165; }
  </style>
</head>
<body>
  <main>
    <h1>Este link ya no está disponible</h1>
    <p>Venció o el negocio lo dio de baja. Pedile que te mande uno nuevo.</p>
  </main>
</body>
</html>`;

/**
 * La misma respuesta para todo lo que falle: token roto, vencido, revocado,
 * factura borrada o anulada. Si cada caso respondiera distinto, probando links
 * se podría averiguar qué facturas existen.
 */
function noDisponible(res: Response): void {
  res
    .status(404)
    .set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" })
    .type("html")
    .send(LINK_NO_DISPONIBLE);
}

// GET /publico/facturas/:token — el PDF, con los datos al día
router.get(
  "/facturas/:token",
  rateLimit({ nombre: "factura-publica", maximo: 30, ventanaMs: 15 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const enlace = verificarEnlace(String(req.params["token"]));
    if (!enlace || !mongoose.isValidObjectId(enlace.facturaId)) return noDisponible(res);

    const factura = await Factura.findById(enlace.facturaId);
    if (
      !factura ||
      factura.estado === "anulada" ||
      (factura.versionEnlace ?? 0) !== enlace.version
    ) {
      return noDisponible(res);
    }

    // Sin rollover a propósito: una visita anónima no cierra facturas.
    const { buffer, nombreArchivo } = await generarPdfFactura(factura);

    res.set({ "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    enviarPdf(res, { buffer, nombreArchivo, disposicion: "inline" });
  })
);

export default router;
