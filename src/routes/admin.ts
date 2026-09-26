import { Router } from "express";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { resumenPlataforma } from "../services/admin/resumen.js";
import { crecimientoPlataforma } from "../services/admin/crecimiento.js";
import {
  cerrarSesiones,
  crearUsuario,
  detalleUsuario,
  editarUsuario,
  eliminarUsuario,
  listarUsuarios,
  reactivarUsuario,
  suspenderUsuario,
} from "../services/admin/usuarios.js";
import {
  detalleMarca,
  editarMarca,
  listarMarcas,
  recalcularTodas,
  recalcularUna,
  sacarDuenoComoAdmin,
  sumarDuenoComoAdmin,
} from "../services/admin/marcas.js";
import { borrarError, detalleError, listarErrores } from "../services/admin/errores.js";
import { estadoSistema } from "../services/admin/sistema.js";
import {
  alcanceAvisos,
  borrarAviso,
  crearAviso,
  detalleAviso,
  enviarPrueba,
  listarAvisos,
  reintentarAviso,
} from "../services/avisos.js";
import type { RequestAutenticado } from "../types/index.js";

// El panel del super_admin: monitorear la plataforma entera y dar soporte.
// Todo acá pide estar logueado como super_admin. Guía para el front en
// doc/SUPER_ADMIN.md.

const router = Router();
router.use(requireAuth, requireSuperAdmin);

// ───────────────────────── Tablero ─────────────────────────
// GET /admin/resumen — los números de la plataforma, en una respuesta.
router.get(
  "/resumen",
  asyncHandler(async (_req, res) => {
    res.json(await resumenPlataforma());
  })
);

// GET /admin/crecimiento?agrupar=dia&dias=30 | ?agrupar=mes&meses=12
router.get(
  "/crecimiento",
  asyncHandler(async (req, res) => {
    res.json(await crecimientoPlataforma(req.query));
  })
);

// GET /admin/sistema — server, base, servicios y versiones de la app en uso.
router.get(
  "/sistema",
  asyncHandler(async (_req, res) => {
    res.json(await estadoSistema());
  })
);

// ───────────────────────── Usuarios ─────────────────────────
router.get(
  "/usuarios",
  asyncHandler(async (req, res) => {
    res.json(await listarUsuarios(req.query));
  })
);

router.post(
  "/usuarios",
  asyncHandler(async (req, res) => {
    res.status(201).json(await crearUsuario(req.body));
  })
);

router.get(
  "/usuarios/:id",
  asyncHandler(async (req, res) => {
    res.json(await detalleUsuario(req.params["id"]));
  })
);

// PUT /admin/usuarios/:id   { nombre?, email?, dni? }
router.put(
  "/usuarios/:id",
  asyncHandler(async (req, res) => {
    res.json(await editarUsuario(req.params["id"], req.body));
  })
);

// POST /admin/usuarios/:id/suspender   { motivo? }
router.post(
  "/usuarios/:id/suspender",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.json(await suspenderUsuario(req.params["id"], req.usuario, req.body?.motivo));
  })
);

router.post(
  "/usuarios/:id/reactivar",
  asyncHandler(async (req, res) => {
    res.json(await reactivarUsuario(req.params["id"]));
  })
);

router.post(
  "/usuarios/:id/cerrar-sesiones",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.json(await cerrarSesiones(req.params["id"], req.usuario));
  })
);

// DELETE /admin/usuarios/:id   { confirmar: "ELIMINAR", eliminarMarca? }
router.delete(
  "/usuarios/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.json(await eliminarUsuario(req.params["id"], req.usuario, req.body));
  })
);

// ───────────────────────── Marcas ─────────────────────────
router.get(
  "/marcas",
  asyncHandler(async (req, res) => {
    res.json(await listarMarcas(req.query));
  })
);

// Va antes de /marcas/:id para que "recalcular" no se lea como un id.
router.post(
  "/marcas/recalcular",
  asyncHandler(async (_req, res) => {
    res.json(await recalcularTodas());
  })
);

router.get(
  "/marcas/:id",
  asyncHandler(async (req, res) => {
    res.json(await detalleMarca(req.params["id"]));
  })
);

// PUT /admin/marcas/:id   { nombre, direccion?, telefono?, colorPrimario?, colorSecundario? }
router.put(
  "/marcas/:id",
  asyncHandler(async (req, res) => {
    res.json(await editarMarca(req.params["id"], req.body));
  })
);

router.post(
  "/marcas/:id/recalcular",
  asyncHandler(async (req, res) => {
    res.json(await recalcularUna(req.params["id"]));
  })
);

// POST /admin/marcas/:id/duenos   { dni }
router.post(
  "/marcas/:id/duenos",
  asyncHandler(async (req, res) => {
    res.status(201).json(await sumarDuenoComoAdmin(req.params["id"], req.body?.dni));
  })
);

router.delete(
  "/marcas/:id/duenos/:usuarioId",
  asyncHandler(async (req, res) => {
    res.json(await sacarDuenoComoAdmin(req.params["id"], String(req.params["usuarioId"])));
  })
);

// ───────────────────────── Errores de la app ─────────────────────────
router.get(
  "/errores",
  asyncHandler(async (req, res) => {
    res.json(await listarErrores(req.query));
  })
);

router.get(
  "/errores/:huella",
  asyncHandler(async (req, res) => {
    res.json(await detalleError(String(req.params["huella"]), req.query));
  })
);

router.delete(
  "/errores/:huella",
  asyncHandler(async (req, res) => {
    res.json(await borrarError(String(req.params["huella"])));
  })
);

// ───────────────────────── Avisos (notificaciones push) ─────────────────────────
// Guía para el front: doc/NOTIFICACIONES.md.
router.get(
  "/avisos",
  asyncHandler(async (req, res) => {
    res.json(await listarAvisos(req.query));
  })
);

// Estas dos van antes de /avisos/:id para que no se lean como un id.
router.get(
  "/avisos/alcance",
  asyncHandler(async (_req, res) => {
    res.json(await alcanceAvisos());
  })
);

// POST /admin/avisos/prueba   { titulo, mensaje, tipo? } — solo a mis teléfonos
router.post(
  "/avisos/prueba",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.json(await enviarPrueba(req.body, req.usuario));
  })
);

// POST /admin/avisos   { titulo, mensaje, tipo? } — a todos; 202, sigue en segundo plano
router.post(
  "/avisos",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.status(202).json(await crearAviso(req.body, req.usuario));
  })
);

router.get(
  "/avisos/:id",
  asyncHandler(async (req, res) => {
    res.json(await detalleAviso(req.params["id"]));
  })
);

router.post(
  "/avisos/:id/reintentar",
  asyncHandler(async (req, res) => {
    res.status(202).json(await reintentarAviso(req.params["id"]));
  })
);

router.delete(
  "/avisos/:id",
  asyncHandler(async (req, res) => {
    res.json(await borrarAviso(req.params["id"]));
  })
);

export default router;
