import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * El artículo concreto que se vende: "Pantalón cargo negro, talle 14".
 *
 * Cada talle es un producto con su propio stock. Es más filas para cargar que
 * un modelo con variantes adentro, pero deja el control de stock exacto y el
 * modelo simple.
 */
export interface ProductoAtributos {
  nombre: string;
  /** A qué tipo pertenece: Pantalón, Remera, Zapatilla. */
  catalogo: Types.ObjectId;
  /** Talle o medida. Texto libre porque conviven "14", "M", "34". */
  talle?: string;
  precio: number;
  stock: number;
  activo: boolean;
  administrador: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ProductoDocument = HydratedDocument<ProductoAtributos>;

const productoSchema = new Schema<ProductoAtributos>(
  {
    nombre: { type: String, required: true, trim: true },
    catalogo: { type: Schema.Types.ObjectId, ref: "Catalogo", required: true },
    talle: { type: String, trim: true },
    precio: { type: Number, required: true, min: 0 },
    stock: { type: Number, default: 0 },
    activo: { type: Boolean, default: true },
    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
  },
  { timestamps: true }
);

// Listar el stock de un negocio, y filtrar por tipo de producto.
productoSchema.index({ administrador: 1, catalogo: 1 });

export default mongoose.model<ProductoAtributos>("Producto", productoSchema);
