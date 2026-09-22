import { Router } from "express";
import Factura, { ESTADOS_FACTURA, type EstadoFactura } from "../models/Factura.js";
import Cliente from "../models/Cliente.js";
import { requireAuth } from "../middleware/auth.js";
import { requireMarca } from "../middleware/marca.js";
import { porMarca, rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { AppError, datosInvalidos, errorDeCampo, noEncontrado } from "../utils/AppError.js";
import { enviarEmail, smtpConfigurado } from "../utils/email.js";
import { enmascararEmail, logger } from "../utils/logger.js";
import { enviarPdf } from "../utils/respuestaPdf.js";
import { EMAIL_VALIDO, patronDeTexto } from "../utils/validaciones.js";
import { enlaceWhatsApp, normalizarTelefonoAR } from "../utils/whatsapp.js";
import { formatearFecha } from "../utils/formato.js";
import { facturaCliente } from "../emails/index.js";
import { CID_LOGO_MARCA } from "../emails/layout.js";
import {
  detalleFactura,
  facturasVencidas,
  leerVencimiento,
  reprogramarVencimiento,
  saldarFactura,
  serializarFactura,
} from "../services/facturacion.js";
import { generarPdfFactura, resumenFactura } from "../services/pdfFactura.js";
import {
  DIAS_VALIDEZ_POR_DEFECTO,
  firmarEnlace,
  urlApi,
} from "../services/enlacesFactura.js";
import type { RequestConMarca } from "../types/index.js";

const router = Router();
router.use(requireAuth, requireMarca);

const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAXIMO = 100;

/** Una factura de la marca, o 404. */
async function facturaPropia(req: RequestConMarca, filtroExtra: Record<string, unknown> = {}) {
  const factura = await Factura.findOne({
    _id: req.params["id"],
    marca: req.marca._id,
    ...filtroExtra,
  });
  if (!factura) throw noEncontrado("Factura", "a");
  return factura;
}

// ─────────────────────────────────────────────────────────────
// GET /facturas/vencidas — las que pasaron su fecha y siguen con saldo
//
// Va antes de /facturas/:id, si no "vencidas" se tomaría como un id.
router.get(
  "/vencidas",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const facturas = await facturasVencidas(req.marca._id);
    res.json(facturas.map(serializarFactura));
  })
);

/**
 * Listar las facturas de la marca.
 *
 * Query params:
 *   estado     abierta | pagada | anulada
 *   cliente    _id, para ver las de uno solo
 *   vencidas   "true" para las que pasaron su fecha y siguen con saldo
 *   buscar     texto en el nombre o el DNI del cliente
 *   pagina     desde 1
 *   porPagina  hasta 100
 *
 * Va paginado como el listado de clientes: sin esto crece con cada factura
 * saldada de cada cliente, y con el tiempo la pantalla se trae miles.
 */
router.get(
  "/",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const filtro: Record<string, unknown> = { marca: req.marca._id };

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
      filtro["estado"] = filtro["estado"] ?? "abierta";
      filtro["venceEl"] = { $lt: new Date() };
      filtro["saldo"] = { $gt: 0 };
    }

    // El texto se busca contra el cliente, que es donde el dueño lo conoce:
    // resolvemos primero qué clientes matchean y filtramos por esos.
    const buscar = typeof req.query["buscar"] === "string" ? req.query["buscar"].trim() : "";
    if (buscar) {
      const patron = patronDeTexto(buscar);
      const clientes = await Cliente.find({
        marca: req.marca._id,
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
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(await detalleFactura(await facturaPropia(req)));
  })
);

// ─────────────────────────────────────────────────────────────
// PUT /facturas/:id/vencimiento   { venceEl: "aaaa-mm-dd" }
//
// "Te pago el 30": la nueva fecha acordada. Cambia cuándo figura vencida; el
// cumplimiento se sigue midiendo contra la fecha que se fijó con el primer
// ticket, así reprogramar no borra el atraso.
router.put(
  "/:id/vencimiento",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const fecha = leerVencimiento(req.body?.venceEl);
    const factura = await reprogramarVencimiento(await facturaPropia(req), fecha);
    res.json(serializarFactura(factura));
  })
);

// PUT /facturas/:id/pagada — cerrarla a mano cuando ya no debe nada
//
// El pago que la deja en cero ya la cierra solo. Esto queda para la factura
// que está en cero sin pagos a cuenta (todo se pagó en el mostrador): al
// cerrarla, la próxima compra abre una nueva. Con deuda no se puede: el
// cliente tiene una sola factura activa hasta que la termina de pagar.
router.put(
  "/:id/pagada",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const factura = await facturaPropia(req, { estado: "abierta" });

    if (factura.saldo > 0) {
      throw datosInvalidos(
        `Todavía queda saldo. Registrá un pago de $${factura.saldo} para saldarla.`,
        { saldo: factura.saldo }
      );
    }
    if (factura.cantidadTickets === 0) {
      throw datosInvalidos("No se puede cerrar una factura sin tickets");
    }

    res.json(serializarFactura(await saldarFactura(factura)));
  })
);

// ─────────────────────────────────────────────────────────────
// La factura en PDF, para mandársela al cliente.
//
// Tres caminos: descargarla (la app la comparte por WhatsApp), mandarla por
// mail, o generar un link público que el cliente abre sin loguearse.

// GET /facturas/:id/pdf — el archivo. ?inline=1 para verlo en el navegador.
router.get(
  "/:id/pdf",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const factura = await facturaPropia(req);
    const { buffer, nombreArchivo } = await generarPdfFactura(factura);

    enviarPdf(res, {
      buffer,
      nombreArchivo,
      disposicion: req.query["inline"] === "1" ? "inline" : "attachment",
    });
  })
);

// POST /facturas/:id/enviar   { email?, mensaje? }
//
// Va al email del cliente, o al que venga en el body (que no se guarda: para
// cambiarle el email al cliente está PUT /clientes/:id).
//
// Los límites cuentan por marca y no por IP: detrás del proxy la IP no
// identifica al negocio (varios dueños, o varios negocios detrás del mismo
// CGNAT). El tope diario frena que la cuenta se use como relay para mandar
// mails a cualquiera desde el remitente de la app (S5).
router.post(
  "/:id/enviar",
  rateLimit({
    nombre: "enviar-factura",
    maximo: 20,
    ventanaMs: 60 * 60 * 1000,
    clave: porMarca,
  }),
  rateLimit({
    nombre: "enviar-factura-dia",
    maximo: 100,
    ventanaMs: 24 * 60 * 60 * 1000,
    clave: porMarca,
  }),
  asyncHandler<RequestConMarca>(async (req, res) => {
    const factura = await facturaPropia(req);
    if (factura.estado === "anulada") throw datosInvalidos("No se puede enviar una factura anulada");

    const cliente = await Cliente.findById(factura.cliente);
    if (!cliente) throw noEncontrado("Cliente");

    const emailDelBody =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const para = emailDelBody || cliente.email;
    if (!para) {
      throw errorDeCampo(
        "email",
        "Este cliente no tiene email cargado. Cargáselo o escribí uno para mandarlo."
      );
    }
    if (!EMAIL_VALIDO.test(para)) {
      throw errorDeCampo("email", "El email no tiene un formato válido");
    }

    const mensaje = typeof req.body?.mensaje === "string" ? req.body.mensaje.trim() : "";
    if (mensaje.length > 500) {
      throw errorDeCampo("mensaje", "El mensaje puede tener hasta 500 caracteres");
    }

    const { buffer, nombreArchivo, datos, logo } = await generarPdfFactura(factura, { cliente });
    const resumen = resumenFactura(datos.factura);

    // El mail sale con la marca: su logo (el mismo PNG del PDF), o su nombre
    // si todavía no subieron uno.
    const mail = facturaCliente({
      nombreCliente: datos.cliente.nombre,
      nombreMarca: datos.marca.nombre,
      cidLogo: logo ? CID_LOGO_MARCA : undefined,
      tituloFactura: resumen.titulo,
      saldo: resumen.saldo,
      alDia: resumen.alDia,
      vencida: resumen.vencida,
      vencimiento: resumen.vencimiento,
      ...(mensaje && { mensaje }),
    });

    const envio = await enviarEmail({
      para,
      ...mail,
      // Las respuestas le llegan al dueño que lo mandó.
      responderA: req.usuario.email,
      adjuntos: [
        ...(logo
          ? [{ filename: "logo.png", content: logo.buffer, contentType: "image/png", cid: CID_LOGO_MARCA }]
          : []),
        { filename: nombreArchivo, content: buffer, contentType: "application/pdf" },
      ],
    });

    if (!envio.enviado) {
      if (!smtpConfigurado()) {
        throw new AppError("El envío de mails no está configurado en el servidor", 503);
      }
      // Sin el motivo SMTP (P11): ya queda en el log de email.ts, y al
      // cliente no le sirve y le muestra cómo está armada la infraestructura.
      throw new AppError(
        "No se pudo enviar el mail. Probá de nuevo o compartila por WhatsApp.",
        502
      );
    }

    // Rastro de quién mandó qué y a dónde, por si la cuenta se usa como relay.
    logger.info(
      `[mail-factura] marca ${String(req.marca._id)} → ${enmascararEmail(para)}${
        emailDelBody && emailDelBody !== cliente.email ? " (email escrito a mano)" : ""
      }`
    );

    res.json({ enviado: true, para, asunto: mail.asunto, archivo: nombreArchivo });
  })
);

// POST /facturas/:id/enlace   { diasValidez? }
//
// Un link que el cliente abre sin loguearse, con el mensaje de WhatsApp ya
// escrito. Siempre muestra los datos del momento en que se abre.
router.post(
  "/:id/enlace",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const crudo = req.body?.diasValidez;
    const dias = crudo === undefined || crudo === null ? DIAS_VALIDEZ_POR_DEFECTO : Number(crudo);
    if (!Number.isInteger(dias) || dias < 1 || dias > 30) {
      throw errorDeCampo(
        "diasValidez",
        "Los días de validez tienen que ser un número entero entre 1 y 30"
      );
    }

    const factura = await facturaPropia(req);
    if (factura.estado === "anulada") {
      throw datosInvalidos("No se puede compartir una factura anulada");
    }

    const cliente = await Cliente.findById(factura.cliente);
    if (!cliente) throw noEncontrado("Cliente");

    const { token, venceEl } = firmarEnlace(factura, dias);
    const url = urlApi(`/publico/facturas/${token}`);

    const resumen = resumenFactura(serializarFactura(factura));
    const primerNombre = cliente.nombre.trim().split(/\s+/)[0] ?? cliente.nombre;

    const textoWhatsApp = [
      `Hola ${primerNombre}! Te paso el detalle de tu cuenta en ${req.marca.nombre} (${resumen.titulo}): ${resumen.frase}.`,
      `Lo podés ver acá: ${url}`,
      `El link vale hasta el ${formatearFecha(venceEl)}.`,
    ].join("\n");

    const telefonoWhatsApp = normalizarTelefonoAR(cliente.telefono);

    res.json({
      url,
      venceEl,
      diasValidez: dias,
      textoWhatsApp,
      urlWhatsApp: enlaceWhatsApp(telefonoWhatsApp, textoWhatsApp),
      telefonoWhatsApp,
    });
  })
);

// DELETE /facturas/:id/enlace — dar de baja todos los links que se mandaron
router.delete(
  "/:id/enlace",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const factura = await Factura.findOneAndUpdate(
      { _id: req.params["id"], marca: req.marca._id },
      { $inc: { versionEnlace: 1 } },
      { new: true }
    );
    if (!factura) throw noEncontrado("Factura", "a");

    res.json({
      mensaje: "Listo: los links que mandaste de esta factura ya no abren.",
      versionEnlace: factura.versionEnlace,
    });
  })
);

export default router;
