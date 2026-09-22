import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import { configCloudinary } from "../services/cloudinary.js";

/**
 * La marca: el negocio que maneja la app. Todo lo del negocio (clientes,
 * especies, facturas, tickets, pagos) es de la marca, no de un usuario.
 *
 * Puede tener varios dueños, todos iguales: "BebyRo" la manejan ella y él, y
 * cualquiera de los dos hace exactamente lo mismo. Un usuario está en UNA
 * sola marca (`usuario.marca`).
 *
 * Los dueños NO se guardan acá: salen de los usuarios que apuntan a esta
 * marca (el virtual `duenos`). Si también hubiera una lista acá, serían dos
 * lugares donde vive el mismo dato y tarde o temprano dirían cosas distintas.
 */

/** Los textos de la marca y su largo máximo. */
export const LARGO_MAXIMO_MARCA = { nombre: 80, direccion: 120, telefono: 40 } as const;

/** Los dos colores que elige la marca para su PDF. */
export const CAMPOS_COLOR_MARCA = ["colorPrimario", "colorSecundario"] as const;
/** Como se guardan: hex de 6 dígitos, en minúscula (ver normalizarColor). */
export const COLOR_HEX = /^#[0-9a-f]{6}$/;

/**
 * Lo que mueve la marca. Guardado para leerlo en una consulta, pero siempre
 * recalculado desde cero (services/marcas.ts): nunca se suma a mano.
 */
export interface EstadisticasMarca {
  cantidadClientes: number;
  /** Todo lo que se llevaron: Σ total de los tickets, sin anulados. */
  totalVendido: number;
  /** La plata que entró: lo que dejaron al comprar + los pagos a cuenta. */
  totalCobrado: number;
  /** Lo que le deben hoy: Σ saldo de las facturas con deuda. */
  deudaPendiente: number;
  actualizadasEl?: Date;
}

export interface MarcaAtributos {
  nombre: string;
  direccion?: string;
  telefono?: string;
  /**
   * URL de entrega en Cloudinary, con versión. El archivo es siempre
   * marcas/<id de la marca>/logo: uno por marca (ver services/cloudinary.ts).
   */
  logoUrl?: string;
  /**
   * Los colores del PDF: el primario para el nombre, el saldo y los títulos;
   * el secundario para los acentos. Sin elegir, el PDF sale con la paleta de
   * la app (ver pdf/paleta.ts).
   */
  colorPrimario?: string;
  colorSecundario?: string;
  creadaPor: Types.ObjectId;
  estadisticas: EstadisticasMarca;
  createdAt: Date;
  updatedAt: Date;
}

export type MarcaDocument = HydratedDocument<MarcaAtributos>;

const estadisticasSchema = new Schema<EstadisticasMarca>(
  {
    cantidadClientes: { type: Number, default: 0 },
    totalVendido: { type: Number, default: 0 },
    totalCobrado: { type: Number, default: 0 },
    deudaPendiente: { type: Number, default: 0 },
    actualizadasEl: { type: Date },
  },
  { _id: false }
);

const marcaSchema = new Schema<MarcaAtributos>(
  {
    nombre: { type: String, required: true, trim: true, maxlength: LARGO_MAXIMO_MARCA.nombre },
    direccion: { type: String, trim: true, maxlength: LARGO_MAXIMO_MARCA.direccion },
    telefono: { type: String, trim: true, maxlength: LARGO_MAXIMO_MARCA.telefono },
    logoUrl: { type: String },
    colorPrimario: { type: String, match: COLOR_HEX },
    colorSecundario: { type: String, match: COLOR_HEX },
    creadaPor: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
    estadisticas: { type: estadisticasSchema, default: () => ({}) },
  },
  // id: false para que el virtual `id` no se sume al JSON junto a `_id`.
  { timestamps: true, id: false, toJSON: { virtuals: true } }
);

/** Los dueños: los usuarios con `marca` apuntando acá. Se trae con populate. */
marcaSchema.virtual("duenos", {
  ref: "Usuario",
  localField: "_id",
  foreignField: "marca",
});

/**
 * Si la app puede ofrecer subir el logo. No es de la marca sino del server:
 * true cuando tiene Cloudinary configurado. Va en el JSON para que el front
 * muestre u oculte el botón de entrada, sin tener que probar la firma.
 */
marcaSchema.virtual("puedeSubirLogo").get(() => configCloudinary() !== null);

export default mongoose.model<MarcaAtributos>("Marca", marcaSchema);
