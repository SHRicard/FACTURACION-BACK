import { Router } from "express";
import Producto from "../models/Producto.js";
import Especie from "../models/Especie.js";
import { requireAuth } from "../middleware/auth.js";
import { requireMarca } from "../middleware/marca.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import type { RequestConMarca } from "../types/index.js";

const router = Router();
router.use(requireAuth, requireMarca);

/** La especie tiene que ser de esta marca: si no, el producto quedaría colgado de otra. */
async function especieDeLaMarca(especieId: unknown, marcaId: unknown) {
  const especie = await Especie.findOne({ _id: especieId, marca: marcaId });
  if (!especie) throw datosInvalidos("La especie indicada no existe");
  return especie;
}

router.get(
  "/",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const filtro: Record<string, unknown> = { marca: req.marca._id };
    // Permite listar solo los pantalones, por ejemplo.
    if (typeof req.query["especie"] === "string") filtro["especie"] = req.query["especie"];

    const productos = await Producto.find(filtro)
      .populate("especie", "nombre")
      .sort({ nombre: 1, talle: 1 });

    res.json(productos);
  })
);

router.get(
  "/:id",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const producto = await Producto.findOne({ _id: req.params["id"], marca: req.marca._id });
    if (!producto) throw noEncontrado("Producto");
    res.json(producto);
  })
);

router.post(
  "/",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const especie = await especieDeLaMarca(req.body?.especie, req.marca._id);

    const producto = await Producto.create({
      nombre: req.body?.nombre,
      especie: especie._id,
      talle: req.body?.talle,
      precio: req.body?.precio,
      stock: req.body?.stock ?? 0,
      marca: req.marca._id,
    });
    res.status(201).json(producto);
  })
);

// Solo los campos que se pueden editar. Antes el body iba entero al update:
// mandando `marca` (antes `administrador`) se le podía pasar el producto a
// otra cuenta, y `especie` aceptaba una especie ajena.
router.put(
  "/:id",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const { nombre, talle, precio, stock, activo, especie } = req.body ?? {};

    const cambios: Record<string, unknown> = { nombre, talle, precio, stock, activo };
    if (especie !== undefined) {
      cambios["especie"] = (await especieDeLaMarca(especie, req.marca._id))._id;
    }
    // Lo que no vino no se toca.
    for (const clave of Object.keys(cambios)) {
      if (cambios[clave] === undefined) delete cambios[clave];
    }

    const producto = await Producto.findOneAndUpdate(
      { _id: req.params["id"], marca: req.marca._id },
      cambios,
      { new: true, runValidators: true }
    );
    if (!producto) throw noEncontrado("Producto");
    res.json(producto);
  })
);

router.delete(
  "/:id",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const producto = await Producto.findOneAndDelete({ _id: req.params["id"], marca: req.marca._id });
    if (!producto) throw noEncontrado("Producto");
    res.json({ mensaje: "Producto eliminado" });
  })
);

export default router;
