import { Router } from "express";
import Catalogo from "../models/Catalogo.js";
import Producto from "../models/Producto.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();
router.use(requireAuth);

// Los tipos de producto del negocio: Pantalón, Remera, Zapatilla.
router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const catalogos = await Catalogo.find({ administrador: req.usuario._id }).sort({ nombre: 1 });
    res.json(catalogos);
  })
);

router.post(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const catalogo = await Catalogo.create({
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      administrador: req.usuario._id,
    });
    res.status(201).json(catalogo);
  })
);

router.put(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const { nombre, descripcion, activo } = req.body ?? {};
    const catalogo = await Catalogo.findOneAndUpdate(
      { _id: req.params["id"], administrador: req.usuario._id },
      { nombre, descripcion, activo },
      { new: true, runValidators: true }
    );
    if (!catalogo) throw noEncontrado("Catálogo");
    res.json(catalogo);
  })
);

// No se borra si tiene productos: los tickets viejos lo siguen nombrando.
router.delete(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const enUso = await Producto.countDocuments({
      catalogo: req.params["id"],
      administrador: req.usuario._id,
    });

    if (enUso > 0) {
      throw datosInvalidos(
        `No se puede borrar: hay ${enUso} producto(s) de este tipo. Desactivalo en su lugar.`,
        { productos: enUso }
      );
    }

    const catalogo = await Catalogo.findOneAndDelete({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });
    if (!catalogo) throw noEncontrado("Catálogo");
    res.json({ mensaje: "Catálogo eliminado" });
  })
);

export default router;
