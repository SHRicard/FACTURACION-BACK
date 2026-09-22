import { Router } from "express";
import Marca from "../models/Marca.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { requireMarca } from "../middleware/marca.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, prohibido } from "../utils/AppError.js";
import { patronDeTexto } from "../utils/validaciones.js";
import {
  crearMarca,
  leerDatosMarca,
  marcaConDuenos,
  sacarDueno,
  sumarDueno,
} from "../services/marcas.js";
import {
  eliminarImagen,
  existeImagen,
  firmaSubidaLogo,
  publicIdLogo,
  urlLogo,
} from "../services/cloudinary.js";
import type { RequestAutenticado, RequestConMarca } from "../types/index.js";

const router = Router();
router.use(requireAuth);

const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAXIMO = 100;

// ─────────────────────────────────────────────────────────────
// GET /marcas — solo super_admin: todas las marcas, con dueños y números
//
// Query: buscar (en el nombre), pagina, porPagina.
router.get(
  "/",
  requireSuperAdmin,
  asyncHandler(async (req, res) => {
    const buscar = typeof req.query["buscar"] === "string" ? req.query["buscar"].trim() : "";
    const filtro = buscar ? { nombre: patronDeTexto(buscar) } : {};

    const pagina = Math.max(1, Number(req.query["pagina"]) || 1);
    const porPagina = Math.min(
      POR_PAGINA_MAXIMO,
      Math.max(1, Number(req.query["porPagina"]) || POR_PAGINA_DEFECTO)
    );

    const [marcas, total] = await Promise.all([
      Marca.find(filtro)
        .populate({ path: "duenos", select: "nombre email dni" })
        .sort({ nombre: 1 })
        .skip((pagina - 1) * porPagina)
        .limit(porPagina),
      Marca.countDocuments(filtro),
    ]);

    res.json({ datos: marcas, total, pagina, porPagina, paginas: Math.ceil(total / porPagina) || 1 });
  })
);

// POST /marcas   { nombre, direccion?, telefono?, colorPrimario?, colorSecundario? }
//
// Crear la marca propia. Los colores son hex ("#4a1866") y tiñen el PDF. Pide el DNI cargado y no tener marca: quien ya está
// en una no se pasa a otra.
router.post(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    if (req.usuario.rol === "super_admin") {
      throw prohibido("El super_admin no tiene marca: entrá con una cuenta de administrador");
    }
    res.status(201).json(await crearMarca(req.usuario, req.body));
  })
);

// ─────────────────────────────────────────────────────────────
// /marcas/mia — la marca del usuario logueado. Todo lo que sigue lo puede
// hacer cualquiera de sus dueños: todos son iguales.
const mia = Router();
router.use("/mia", requireMarca, mia);

// GET /marcas/mia — la marca, sus dueños y lo que mueve
mia.get(
  "/",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(await marcaConDuenos(req.marca._id));
  })
);

// PUT /marcas/mia   { nombre, direccion?, telefono?, colorPrimario?, colorSecundario? }
//
// Reemplaza los textos: el front manda el formulario como quedó. El nombre
// es obligatorio; dirección o teléfono vacíos se borran. Los colores solo
// cambian si vienen (null los saca). El logo no se toca.
mia.put(
  "/",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const { $set, $unset } = leerDatosMarca(req.body);
    await Marca.updateOne(
      { _id: req.marca._id },
      { $set, ...(Object.keys($unset).length > 0 && { $unset }) },
      { runValidators: true }
    );
    res.json(await marcaConDuenos(req.marca._id));
  })
);

// ─── Logo: uno por marca, y punto (ver services/cloudinary.ts) ───

// POST /marcas/mia/logo/firma — paso 1: la firma para subirlo directo a Cloudinary
mia.post(
  "/logo/firma",
  rateLimit({ nombre: "firma-logo", maximo: 30, ventanaMs: 60 * 60 * 1000 }),
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(firmaSubidaLogo(String(req.marca._id)));
  })
);

// PUT /marcas/mia/logo   { version }
//
// Paso 2: avisar que ya se subió, con la `version` que devolvió Cloudinary. El
// archivo es siempre el de esta marca y la URL la arma el backend.
mia.put(
  "/logo",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const crudo = req.body?.version;
    const version = Number(crudo);
    if (crudo === undefined || crudo === null || !Number.isInteger(version) || version <= 0) {
      throw datosInvalidos(
        'Falta la versión del logo: es el campo "version" que devuelve Cloudinary al subirlo',
        { version: crudo }
      );
    }

    const logoUrl = urlLogo(publicIdLogo(String(req.marca._id)), version);
    if (!(await existeImagen(logoUrl))) {
      throw datosInvalidos("No encontramos el logo en Cloudinary. Probá subirlo de nuevo.");
    }

    await Marca.updateOne({ _id: req.marca._id }, { $set: { logoUrl } });
    res.json(await marcaConDuenos(req.marca._id));
  })
);

// DELETE /marcas/mia/logo — sacar el logo: el PDF sigue con el nombre solo
mia.delete(
  "/logo",
  asyncHandler<RequestConMarca>(async (req, res) => {
    await Marca.updateOne({ _id: req.marca._id }, { $unset: { logoUrl: "" } });
    // Se borra siempre: si subieron uno y nunca lo confirmaron, también se va.
    void eliminarImagen(publicIdLogo(String(req.marca._id)));
    res.json(await marcaConDuenos(req.marca._id));
  })
);

// ─── Dueños ───

// POST /marcas/mia/duenos   { dni }
//
// Suma a alguien al instante, por su DNI. Solo si tiene cuenta, ya cargó su
// DNI y todavía no tiene marca.
mia.post(
  "/duenos",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.status(201).json(await sumarDueno(req.marca, req.body?.dni));
  })
);

// DELETE /marcas/mia/duenos/:usuarioId — sacar a un dueño, o irse (el propio id)
//
// El que sale queda sin marca y vuelve a empezar; no se lleva nada. La marca
// nunca queda sin dueños.
mia.delete(
  "/duenos/:usuarioId",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const usuarioId = String(req.params["usuarioId"]);
    const marca = await sacarDueno(req.marca, usuarioId);

    if (usuarioId === String(req.usuario._id)) {
      res.json({ mensaje: `Saliste de ${req.marca.nombre}`, marca: null, pendiente: "marca" });
      return;
    }
    res.json(marca);
  })
);

export default router;
