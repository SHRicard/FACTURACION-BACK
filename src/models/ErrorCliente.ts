import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * Un error que reportó la app (K12): un render que explotó o un error JS
 * fatal. No hay Sentry ni Crashlytics, así que la app los manda a
 * POST /app/errores y quedan acá para poder consultarlos.
 *
 * Se guardan 30 días (índice TTL) y ya redactados: sin emails, DNIs ni
 * tokens. La IP NO se guarda: para agrupar alcanza con la huella y para
 * saber a quién le pasó, con el usuario si estaba logueado.
 */
export const PLATAFORMAS_CLIENTE = ["android", "ios", "web"] as const;
export type PlataformaCliente = (typeof PLATAFORMAS_CLIENTE)[number];

export interface ErrorClienteAtributos {
  mensaje: string;
  /** El tipo del error: "TypeError", "Error"… */
  nombre?: string;
  stack?: string;
  /** El árbol de componentes de React donde explotó el render. */
  componentStack?: string;
  /** Pantalla de expo-router, sin query. */
  ruta?: string;
  /** true si tiró abajo la app (handler global), false si lo atajó un ErrorBoundary. */
  fatal: boolean;
  /** Versión de la app que lo reportó. */
  version: string;
  plataforma: PlataformaCliente;
  versionSO?: string;
  dispositivo?: string;
  /** Cuándo pasó según el teléfono (puede diferir de createdAt si se mandó tarde). */
  ocurridoEn: Date;
  usuario?: Types.ObjectId;
  marca?: Types.ObjectId;
  /** sha256 de nombre + mensaje + primer frame del stack: agrupa el mismo error. */
  huella: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ErrorClienteDocument = HydratedDocument<ErrorClienteAtributos>;

const errorClienteSchema = new Schema<ErrorClienteAtributos>(
  {
    mensaje: { type: String, required: true },
    nombre: { type: String },
    stack: { type: String },
    componentStack: { type: String },
    ruta: { type: String },
    fatal: { type: Boolean, default: false },
    version: { type: String, required: true },
    plataforma: { type: String, enum: PLATAFORMAS_CLIENTE, required: true },
    versionSO: { type: String },
    dispositivo: { type: String },
    ocurridoEn: { type: Date, required: true },
    usuario: { type: Schema.Types.ObjectId, ref: "Usuario" },
    marca: { type: Schema.Types.ObjectId, ref: "Marca" },
    huella: { type: String, required: true },
  },
  { timestamps: true, collection: "errores_cliente" }
);

// Mongo borra solo los de más de 30 días: es para diagnosticar, no un archivo.
errorClienteSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
// "¿Cuántas veces pasó este error y cuándo fue la última?"
errorClienteSchema.index({ huella: 1, createdAt: -1 });

export default mongoose.model<ErrorClienteAtributos>("ErrorCliente", errorClienteSchema);
