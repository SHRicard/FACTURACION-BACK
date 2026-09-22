import { Router } from "express";
import Usuario from "../models/Usuario.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { esRol, ROL_POR_DEFECTO } from "../config/roles.js";
import { normalizarDni } from "../utils/validaciones.js";

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

// Corregir el DNI de un usuario. El usuario lo carga una sola vez; si se
// equivocó, lo corrige el super_admin. Un DNI repetido responde 409.
router.put(
  "/:id/dni",
  asyncHandler(async (req, res) => {
    const dni = normalizarDni(req.body?.dni);
    if (!dni) throw datosInvalidos("El DNI tiene que tener 7 u 8 números", { campo: "dni" });

    const usuario = await Usuario.findByIdAndUpdate(
      req.params["id"],
      { dni },
      { new: true, runValidators: true }
    );
    if (!usuario) throw noEncontrado("Usuario");
    res.json(usuario);
  })
);

// Eliminar un administrador
//
// Lo de su marca queda: es de la marca, no de él. Lo único que se cuida es
// que la marca no quede sin dueños.
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const usuario = await Usuario.findById(req.params["id"]);
    if (!usuario) throw noEncontrado("Usuario");

    if (usuario.marca && (await Usuario.countDocuments({ marca: usuario.marca })) <= 1) {
      throw datosInvalidos(
        "Es el único dueño de su marca: la marca no puede quedar sin dueños. Sumá a otro dueño antes de borrarlo."
      );
    }

    await usuario.deleteOne();
    res.json({ mensaje: "Usuario eliminado" });
  })
);

export default router;
