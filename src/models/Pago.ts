import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * El cliente entrega plata a cuenta, sin llevarse nada.
 *
 * Distinto del pago parcial que se hace dentro de un ticket (`ticket.pagado`),
 * que ocurre en el momento de la compra.
 *
 * Un pago siempre descuenta de UNA factura. Cuando el cliente deja una plata
 * que alcanza para más de una, esa entrega se guarda como varios pagos —uno
 * por factura— que comparten el mismo `entrega`. Así cada factura muestra
 * exactamente cuánto le tocó, y la entrega se puede reconstruir entera.
 */
export const METODOS_PAGO = ["efectivo", "transferencia", "mercadopago", "otro"] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export interface PagoAtributos {
  /** A qué factura se imputa. */
  factura: Types.ObjectId;
  cliente: Types.ObjectId;
  marca: Types.ObjectId;

  fecha: Date;
  /** Lo que descontó de ESTA factura. */
  monto: number;
  metodoPago: MetodoPago;
  nota?: string;

  /** Agrupa los pagos que salieron de la misma plata que dejó el cliente. */
  entrega?: Types.ObjectId;
  /** Lo que dejó en total esa vez. Igual a `monto` si fue a una sola factura. */
  montoEntrega?: number;

  /**
   * El recibo: cuánto debía la factura y cuánto quedó, en ese momento.
   *
   * Es una foto, no un derivado. Si después se le pega otro ticket a la
   * factura, el pago sigue diciendo lo que pasó el día que se hizo.
   */
  saldoAnterior?: number;
  saldoPosterior?: number;

  registradoPor?: Types.ObjectId;

  /** Baja lógica, mismo criterio que el ticket: se tacha, no se borra. */
  anulado: boolean;
  anuladoEl?: Date;
  motivoAnulacion?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type PagoDocument = HydratedDocument<PagoAtributos>;

/**
 * Si el pago dejó la factura en cero o no. Derivado de la foto del recibo.
 * Los pagos anteriores a que existiera el recibo no tienen cómo saberlo.
 */
export const tipoDePago = (
  p: Pick<PagoAtributos, "saldoPosterior">
): "completo" | "parcial" | null => {
  if (p.saldoPosterior === undefined || p.saldoPosterior === null) return null;
  return p.saldoPosterior <= 0 ? "completo" : "parcial";
};

const pagoSchema = new Schema<PagoAtributos>(
  {
    factura: { type: Schema.Types.ObjectId, ref: "Factura", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },
    marca: { type: Schema.Types.ObjectId, ref: "Marca", required: true },

    fecha: { type: Date, default: Date.now },
    monto: { type: Number, required: true, min: 0 },
    metodoPago: { type: String, enum: METODOS_PAGO, default: "efectivo" },
    nota: { type: String, trim: true, maxlength: 300 },

    entrega: { type: Schema.Types.ObjectId },
    montoEntrega: { type: Number, min: 0 },

    saldoAnterior: { type: Number },
    saldoPosterior: { type: Number },

    registradoPor: { type: Schema.Types.ObjectId, ref: "Usuario" },

    anulado: { type: Boolean, default: false },
    anuladoEl: { type: Date },
    motivoAnulacion: { type: String, trim: true },
  },
  { timestamps: true }
);

// El front necesita saber si fue completo o parcial sin comparar saldos.
pagoSchema.set("toJSON", {
  transform: (_doc, ret) => ({ ...ret, tipo: tipoDePago(ret) }),
});

pagoSchema.index({ factura: 1, fecha: 1 });
pagoSchema.index({ cliente: 1, fecha: -1 });
pagoSchema.index({ entrega: 1 });

export default mongoose.model<PagoAtributos>("Pago", pagoSchema);
