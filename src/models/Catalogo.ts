import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * El tipo genérico de producto: "Pantalón", "Remera", "Zapatilla".
 *
 * Está por encima del producto concreto. Sirve para dos cosas: que el
 * administrador vea de un vistazo qué se llevó el cliente sin leer modelo por
 * modelo, y para las métricas de qué se vende más sin importar talle ni color.
 */
export interface CatalogoAtributos {
  nombre: string;
  descripcion?: string;
  /** Se desactiva en vez de borrarse: los tickets viejos lo siguen nombrando. */
  activo: boolean;
  administrador: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type CatalogoDocument = HydratedDocument<CatalogoAtributos>;

const catalogoSchema = new Schema<CatalogoAtributos>(
  {
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true },
    activo: { type: Boolean, default: true },
    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
  },
  { timestamps: true }
);

// Un negocio no puede tener dos catálogos con el mismo nombre.
catalogoSchema.index({ administrador: 1, nombre: 1 }, { unique: true });

export default mongoose.model<CatalogoAtributos>("Catalogo", catalogoSchema);
