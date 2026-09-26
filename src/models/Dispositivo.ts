import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * Un teléfono que puede recibir notificaciones push. La app lo registra al
 * abrir (POST /app/dispositivos) con el token que le da Expo.
 *
 * Es del teléfono, no de la cuenta: se registra aunque nadie haya iniciado
 * sesión, porque los avisos del super_admin le llegan a todo el que tenga la
 * app instalada. `usuario` es solo quién lo estaba usando la última vez.
 *
 * Los que desinstalaron la app se borran solos: Expo avisa que el token ya no
 * existe (DeviceNotRegistered) y services/avisos.ts los saca.
 */
export const PLATAFORMAS_DISPOSITIVO = ["android", "ios"] as const;
export type PlataformaDispositivo = (typeof PLATAFORMAS_DISPOSITIVO)[number];

/** Como los da Expo: ExponentPushToken[xxxxxxxx] (o ExpoPushToken[…]). */
export const TOKEN_EXPO = /^Expo(nent)?PushToken\[[^\]\s]{8,200}\]$/;

export interface DispositivoAtributos {
  token: string;
  plataforma: PlataformaDispositivo;
  /** La versión de la app la última vez que se registró (header X-App-Version). */
  version?: string;
  usuario?: Types.ObjectId | null;
  /** La última vez que la app se registró: cada vez que se abre. */
  ultimoUso: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type DispositivoDocument = HydratedDocument<DispositivoAtributos>;

const dispositivoSchema = new Schema<DispositivoAtributos>(
  {
    token: { type: String, required: true, unique: true, match: TOKEN_EXPO },
    plataforma: { type: String, enum: PLATAFORMAS_DISPOSITIVO, required: true },
    version: { type: String },
    usuario: { type: Schema.Types.ObjectId, ref: "Usuario" },
    ultimoUso: { type: Date, required: true },
  },
  { timestamps: true, collection: "dispositivos" }
);

// Los teléfonos de una cuenta: la prueba del super_admin y la baja de cuenta.
dispositivoSchema.index({ usuario: 1 });

export default mongoose.model<DispositivoAtributos>("Dispositivo", dispositivoSchema);
