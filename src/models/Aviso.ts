import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * Un aviso del super_admin a todos los que tienen la app: un mantenimiento,
 * una funcionalidad nueva, una versión nueva. Sale como notificación push a
 * cada teléfono registrado y queda en la lista de avisos de la app
 * (GET /app/avisos) para el que no tiene las notificaciones activadas.
 *
 * El envío corre en segundo plano (services/avisos.ts). `envio.cursor` es el
 * último teléfono al que se le mandó: si el server se reinicia a mitad de
 * camino, sigue desde ahí en vez de mandarlo dos veces.
 */
export const TIPOS_AVISO = ["novedad", "mantenimiento", "version", "aviso"] as const;
export type TipoAviso = (typeof TIPOS_AVISO)[number];

export const ESTADOS_AVISO = ["enviando", "enviado", "fallido"] as const;
export type EstadoAviso = (typeof ESTADOS_AVISO)[number];

/** Largos máximos: lo que entra cómodo en una notificación. */
export const LARGO_MAXIMO_AVISO = { titulo: 60, mensaje: 500 } as const;

export interface EnvioAviso {
  /** A cuántos teléfonos se le iba a mandar cuando arrancó el envío. */
  dispositivos: number;
  /** Los que Expo aceptó. */
  enviados: number;
  /** Los que Expo no aceptó (token dado de baja, credenciales…). */
  rechazados: number;
  /** Confirmados por Google/Apple (llega unos 15 minutos después). */
  entregados: number;
  /** Google/Apple no los pudo entregar. */
  fallidos: number;
  /** Cuántas veces apareció cada código de error de Expo. */
  errores: Record<string, number>;
  cursor?: Types.ObjectId;
  ultimoError?: string;
}

export interface AvisoAtributos {
  titulo: string;
  mensaje: string;
  tipo: TipoAviso;
  creadoPor: Types.ObjectId;
  estado: EstadoAviso;
  enviadoEl?: Date;
  envio: EnvioAviso;
  createdAt: Date;
  updatedAt: Date;
}

export type AvisoDocument = HydratedDocument<AvisoAtributos>;

const envioSchema = new Schema<EnvioAviso>(
  {
    dispositivos: { type: Number, default: 0 },
    enviados: { type: Number, default: 0 },
    rechazados: { type: Number, default: 0 },
    entregados: { type: Number, default: 0 },
    fallidos: { type: Number, default: 0 },
    errores: { type: Schema.Types.Mixed, default: () => ({}) },
    cursor: { type: Schema.Types.ObjectId },
    ultimoError: { type: String },
  },
  { _id: false, minimize: false }
);

const avisoSchema = new Schema<AvisoAtributos>(
  {
    titulo: { type: String, required: true, trim: true, maxlength: LARGO_MAXIMO_AVISO.titulo },
    mensaje: { type: String, required: true, trim: true, maxlength: LARGO_MAXIMO_AVISO.mensaje },
    tipo: { type: String, enum: TIPOS_AVISO, default: "aviso" },
    creadoPor: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
    estado: { type: String, enum: ESTADOS_AVISO, default: "enviando" },
    enviadoEl: { type: Date },
    envio: { type: envioSchema, default: () => ({}) },
  },
  {
    timestamps: true,
    collection: "avisos",
    // El cursor es un detalle del envío: no sale en el JSON.
    toJSON: {
      transform: (_doc, ret) => {
        if (ret.envio) delete ret.envio.cursor;
        return ret;
      },
    },
  }
);

// La lista de la app y el historial del panel: los últimos primero.
avisoSchema.index({ createdAt: -1 });

export default mongoose.model<AvisoAtributos>("Aviso", avisoSchema);
