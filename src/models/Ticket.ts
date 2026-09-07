import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * Una compra fiada: lo que el cliente se llevó en una visita.
 *
 * Los datos del producto se copian, no solo se referencian: si mañana cambia
 * el precio del pantalón, el ticket viejo tiene que seguir diciendo lo que
 * costó ese día.
 */
export interface ItemTicket {
  producto: Types.ObjectId;
  /** Copia, para las métricas por tipo sin tener que buscar el producto. */
  catalogo: Types.ObjectId;
  catalogoNombre: string;
  nombre: string;
  talle?: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface TicketAtributos {
  /** A qué factura se pegó. Siempre la que estaba abierta al cargarlo. */
  factura: Types.ObjectId;
  cliente: Types.ObjectId;
  administrador: Types.ObjectId;

  fecha: Date;
  items: ItemTicket[];

  /** Valor de la mercadería. */
  total: number;
  /**
   * Lo que dejó en el momento. El caso típico: se lleva $5000, deja $2000 y
   * quedan $3000 anotados. Lo que suma a la cuenta es el faltante.
   */
  pagado: number;

  registradoPor: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type TicketDocument = HydratedDocument<TicketAtributos>;

/** Lo que quedó debiendo de este ticket. Derivado, para que no pueda desfasarse. */
export const faltanteDe = (t: Pick<TicketAtributos, "total" | "pagado">): number =>
  Math.max(t.total - (t.pagado ?? 0), 0);

const itemSchema = new Schema<ItemTicket>(
  {
    producto: { type: Schema.Types.ObjectId, ref: "Producto", required: true },
    catalogo: { type: Schema.Types.ObjectId, ref: "Catalogo", required: true },
    catalogoNombre: { type: String, required: true },
    nombre: { type: String, required: true },
    talle: { type: String },
    cantidad: { type: Number, required: true, min: 1 },
    precioUnitario: { type: Number, required: true },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const ticketSchema = new Schema<TicketAtributos>(
  {
    factura: { type: Schema.Types.ObjectId, ref: "Factura", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },
    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },

    fecha: { type: Date, default: Date.now },
    items: { type: [itemSchema], required: true },

    total: { type: Number, required: true, min: 0 },
    pagado: { type: Number, default: 0, min: 0 },

    registradoPor: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
  },
  { timestamps: true }
);

// El front necesita el faltante sin tener que restarlo.
ticketSchema.set("toJSON", {
  transform: (_doc, ret) => ({ ...ret, faltante: faltanteDe(ret) }),
});

ticketSchema.index({ factura: 1, fecha: 1 });
ticketSchema.index({ cliente: 1, fecha: -1 });
// Para las métricas de qué tipo de producto se vende más.
ticketSchema.index({ administrador: 1, "items.catalogo": 1, fecha: -1 });

export default mongoose.model<TicketAtributos>("Ticket", ticketSchema);
