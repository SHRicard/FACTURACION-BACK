import { Router } from "express";
import Especie from "../models/Especie.js";
import Producto from "../models/Producto.js";
import Ticket from "../models/Ticket.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noEncontrado } from "../utils/AppError.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();
router.use(requireAuth);

// Los tipos de mercadería del negocio: Pantalón, Pantalón corto, Zapatilla.
router.get(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const especies = await Especie.find({ administrador: req.usuario._id }).sort({ nombre: 1 });
    res.json(especies);
  })
);

router.post(
  "/",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const especie = await Especie.create({
      nombre: req.body?.nombre,
      descripcion: req.body?.descripcion,
      administrador: req.usuario._id,
    });
    res.status(201).json(especie);
  })
);

router.put(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const { nombre, descripcion, activo } = req.body ?? {};
    const especie = await Especie.findOneAndUpdate(
      { _id: req.params["id"], administrador: req.usuario._id },
      { nombre, descripcion, activo },
      { new: true, runValidators: true }
    );
    if (!especie) throw noEncontrado("Especie", "a");
    res.json(especie);
  })
);

// No se borra si algún ticket la nombra: el historial quedaría hablando de un
// tipo de mercadería que ya no existe, y con él se van las métricas.
router.delete(
  "/:id",
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const especieId = req.params["id"];

    const [enTickets, enProductos] = await Promise.all([
      Ticket.countDocuments({ administrador: req.usuario._id, "items.especie": especieId }),
      Producto.countDocuments({ administrador: req.usuario._id, especie: especieId }),
    ]);

    if (enTickets > 0) {
      throw datosInvalidos(
        `No se puede borrar: hay ${enTickets} ticket(s) con mercadería de esta especie. Desactivala en su lugar.`,
        { tickets: enTickets, productos: enProductos }
      );
    }

    if (enProductos > 0) {
      throw datosInvalidos(
        `No se puede borrar: hay ${enProductos} producto(s) de esta especie en la lista de precios. Desactivala en su lugar.`,
        { tickets: 0, productos: enProductos }
      );
    }

    const especie = await Especie.findOneAndDelete({
      _id: especieId,
      administrador: req.usuario._id,
    });
    if (!especie) throw noEncontrado("Especie", "a");
    res.json({ mensaje: "Especie eliminada" });
  })
);

export default router;
