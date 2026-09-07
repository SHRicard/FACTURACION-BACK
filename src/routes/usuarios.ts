import { Router } from "express";
import Usuario from "../models/Usuario.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { noEncontrado } from "../utils/AppError.js";
import { esRol, ROL_POR_DEFECTO } from "../config/roles.js";

const router = Router();

// Todas las rutas de este archivo requieren estar logueado y ser super_admin
router.use(requireAuth, requireSuperAdmin);

// Listar todos los administradores
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const usuarios = await Usuario.find().sort({ createdAt: -1 });
    res.json(usuarios);
  })
);

// Crear un nuevo administrador
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const { nombre, email, password, rol } = req.body ?? {};
    const usuario = await Usuario.create({
      nombre,
      email,
      password,
      // El super_admin sí puede elegir el rol, pero solo uno de los declarados.
      rol: esRol(rol) ? rol : ROL_POR_DEFECTO,
    });
    res.status(201).json(usuario);
  })
);

// Eliminar un administrador
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const usuario = await Usuario.findByIdAndDelete(req.params["id"]);
    if (!usuario) throw noEncontrado("Usuario");
    res.json({ mensaje: "Usuario eliminado" });
  })
);

export default router;
