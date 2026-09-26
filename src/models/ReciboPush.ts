import mongoose, { Schema, type Types } from "mongoose";

/**
 * Una notificación que Expo aceptó y todavía no confirmó.
 *
 * Expo responde al instante con un "ticket" (la aceptó), pero recién unos 15
 * minutos después sabe si Google/Apple la entregó: eso es el "recibo". Acá se
 * guarda el id del ticket hasta que services/avisos.ts pide el recibo, suma
 * el resultado al aviso y lo borra. Expo guarda los recibos 24 horas: lo que
 * quede más de dos días acá se borra solo.
 */
export interface ReciboPushAtributos {
  aviso: Types.ObjectId;
  ticket: string;
  /** Para dar de baja el teléfono si el recibo dice que desinstaló la app. */
  token: string;
  createdAt: Date;
}

const reciboPushSchema = new Schema<ReciboPushAtributos>(
  {
    aviso: { type: Schema.Types.ObjectId, ref: "Aviso", required: true },
    ticket: { type: String, required: true },
    token: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "recibos_push" }
);

reciboPushSchema.index({ createdAt: 1 }, { expireAfterSeconds: 2 * 24 * 3600 });

export default mongoose.model<ReciboPushAtributos>("ReciboPush", reciboPushSchema);
