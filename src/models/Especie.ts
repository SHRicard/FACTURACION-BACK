import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * El tipo de mercadería: "Pantalón", "Pantalón corto", "Zapatilla", "Media".
 *
 * Es lo único que la marca carga antes de vender, y lo carga una vez.
 * El artículo concreto no se da de alta en ningún lado: se escribe en el
 * ticket, con su nombre y su precio de ese día. La especie es la etiqueta que
 * agrupa esos ítems escritos a mano, para que después se pueda saber qué se
 * vende más sin importar cómo se haya escrito cada vez.
 *
 * Por eso la lista tiene que quedar corta: son categorías, no productos.
 */
export interface EspecieAtributos {
  nombre: string;
  descripcion?: string;
  /** Se desactiva en vez de borrarse: los tickets viejos la siguen nombrando. */
  activo: boolean;
  marca: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type EspecieDocument = HydratedDocument<EspecieAtributos>;

const especieSchema = new Schema<EspecieAtributos>(
  {
    nombre: { type: String, required: true, trim: true },
    descripcion: { type: String, trim: true },
    activo: { type: Boolean, default: true },
    marca: { type: Schema.Types.ObjectId, ref: "Marca", required: true },
  },
  { timestamps: true, collection: "especies" }
);

// Una marca no puede tener dos especies con el mismo nombre.
especieSchema.index({ marca: 1, nombre: 1 }, { unique: true });

export default mongoose.model<EspecieAtributos>("Especie", especieSchema);
