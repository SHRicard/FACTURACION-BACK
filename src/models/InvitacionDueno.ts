import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * La invitación a sumarse como dueño de una marca.
 *
 * Antes un dueño sumaba a otra persona al instante con solo su DNI. Pero el
 * DNI no se verifica (cada uno carga el suyo), así que un tipeo o un DNI
 * ocupado por otra cuenta le abría el negocio a un extraño. Ahora el DNI solo
 * sirve para dirigir la invitación: la persona la ve en su app y decide si la
 * acepta. Hasta entonces no entra a nada ni se devuelve ningún dato suyo.
 *
 * La invitación guarda el DNI y no el usuario: se busca por DNI al leerla,
 * así también le llega a quien se registra después con ese DNI.
 */

export const ESTADOS_INVITACION = [
  "pendiente",
  "aceptada",
  "rechazada",
  "cancelada",
  "vencida",
] as const;
export type EstadoInvitacion = (typeof ESTADOS_INVITACION)[number];

/** Cuánto dura una invitación sin responder. */
export const DIAS_VALIDEZ_INVITACION = 7;
/** Cuántas pendientes puede tener una marca a la vez. */
export const MAXIMO_PENDIENTES = 10;

export interface InvitacionDuenoAtributos {
  marca: Types.ObjectId;
  /** DNI al que va dirigida, sin puntos. */
  dni: string;
  /**
   * El dueño que la mandó. No es obligatorio: si esa persona borra su cuenta
   * se le hace $unset, igual que a `registradoPor` de tickets y pagos, para
   * no dejar nada que la identifique.
   */
  invitadoPor?: Types.ObjectId;
  estado: EstadoInvitacion;
  venceEl: Date;
  respondidaEl?: Date;
  /** Quien la aceptó o la rechazó. */
  usuario?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type InvitacionDuenoDocument = HydratedDocument<InvitacionDuenoAtributos>;

const invitacionDuenoSchema = new Schema<InvitacionDuenoAtributos>(
  {
    marca: { type: Schema.Types.ObjectId, ref: "Marca", required: true },
    dni: { type: String, required: true, trim: true, match: /^\d{7,8}$/ },
    invitadoPor: { type: Schema.Types.ObjectId, ref: "Usuario" },
    estado: { type: String, enum: ESTADOS_INVITACION, default: "pendiente" },
    venceEl: { type: Date, required: true },
    respondidaEl: { type: Date },
    usuario: { type: Schema.Types.ObjectId, ref: "Usuario" },
  },
  { timestamps: true, collection: "invitaciones" }
);

// Una sola pendiente por DNI en cada marca. Parcial: las respondidas,
// canceladas o vencidas no cuentan, así se puede volver a invitar.
invitacionDuenoSchema.index(
  { marca: 1, dni: 1 },
  { unique: true, partialFilterExpression: { estado: "pendiente" } }
);
// Lo que lee el invitado: sus pendientes sin vencer.
invitacionDuenoSchema.index({ dni: 1, estado: 1, venceEl: 1 });
// La lista del dueño.
invitacionDuenoSchema.index({ marca: 1, estado: 1 });
// Una invitación, pendiente o respondida, no se guarda más de 30 días después
// de vencer: tiene el DNI de una persona, y pasado ese plazo no sirve para nada.
invitacionDuenoSchema.index({ venceEl: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

export default mongoose.model<InvitacionDuenoAtributos>("InvitacionDueno", invitacionDuenoSchema);
