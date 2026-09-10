import { Router } from "express";
import Producto from "../models/Producto.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import Especie from "../models/Especie.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();

router.use(requireAuth);

router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const filtro: Record<string, unknown> = { administrador: req.usuario._id };
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
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const producto = await Producto.findOne({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });
    if (!producto) throw noEncontrado("Producto");
    res.json(producto);
  })
);

router.post(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    // El catálogo tiene que existir y ser de este negocio: si no, un producto
    // quedaría colgado de un tipo que no le pertenece.
    const especie = await Especie.findOne({
      _id: req.body?.especie,
      administrador: req.usuario._id,
    });
    if (!especie) throw datosInvalidos("La especie indicada no existe");

    const producto = await Producto.create({
      nombre: req.body?.nombre,
      especie: especie._id,
      talle: req.body?.talle,
      precio: req.body?.precio,
      stock: req.body?.stock ?? 0,
      administrador: req.usuario._id,
    });
    res.status(201).json(producto);
  })
);

router.put(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const producto = await Producto.findOneAndUpdate(
      { _id: req.params["id"], administrador: req.usuario._id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!producto) throw noEncontrado("Producto");
    res.json(producto);
  })
);

router.delete(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const producto = await Producto.findOneAndDelete({
      _id: req.params["id"],
      administrador: req.usuario._id,
    });
    if (!producto) throw noEncontrado("Producto");
    res.json({ mensaje: "Producto eliminado" });
  })
);

export default router;
