import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * El cliente entrega plata a cuenta, sin llevarse nada.
 *
 * Distinto del pago parcial que se hace dentro de un ticket (`ticket.pagado`),
 * que ocurre en el momento de la compra.
 */
export interface PagoAtributos {
  /** A qué factura se imputa. */
  factura: Types.ObjectId;
  cliente: Types.ObjectId;
  administrador: Types.ObjectId;

  fecha: Date;
  monto: number;
  metodoPago?: string;
  nota?: string;

  registradoPor: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PagoDocument = HydratedDocument<PagoAtributos>;

const pagoSchema = new Schema<PagoAtributos>(
  {
    factura: { type: Schema.Types.ObjectId, ref: "Factura", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },
    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },

    fecha: { type: Date, default: Date.now },
    monto: { type: Number, required: true, min: 0 },
    metodoPago: { type: String, trim: true },
    nota: { type: String, trim: true },

    registradoPor: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
  },
  { timestamps: true }
);

pagoSchema.index({ factura: 1, fecha: 1 });
pagoSchema.index({ cliente: 1, fecha: -1 });

export default mongoose.model<PagoAtributos>("Pago", pagoSchema);
