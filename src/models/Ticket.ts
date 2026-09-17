import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * Un renglón del ticket: lo que el cliente se llevó, escrito a mano.
 *
 * No sale de un inventario cargado de antemano. El administrador escribe el
 * nombre y el precio del día, y elige la especie de su lista. El ítem queda
 * congelado en el ticket: si mañana el pantalón sale otra cosa, el ticket
 * viejo tiene que seguir diciendo lo que costó ese día.
 */
export interface ItemTicket {
  /** Lo que escribió el administrador: "Pantalón largo". */
  nombre: string;
  /** Talle o medida. Texto libre porque conviven "34", "M", "XL". */
  talle?: string;
  /** El tipo de mercadería, elegido de su lista de especies. */
  especie: Types.ObjectId;
  /** Copia del nombre, para las métricas y para que el ticket viejo se lea solo. */
  especieNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface TicketAtributos {
  /** A qué factura se pegó. Siempre la que estaba abierta al cargarlo. */
  factura: Types.ObjectId;
  cliente: Types.ObjectId;
  marca: Types.ObjectId;

  fecha: Date;
  items: ItemTicket[];

  /** Valor de la mercadería. */
  total: number;
  /**
   * Lo que dejó en el momento. El caso típico: se lleva $5000, deja $2000 y
   * quedan $3000 anotados. Lo que suma a la cuenta es el faltante.
   */
  pagado: number;

  registradoPor?: Types.ObjectId;

  /**
   * Baja lógica. El ticket cargado por error no se borra: se tacha.
   *
   * Se anota en una libreta, y en una libreta lo que se escribió mal se cruza
   * con una raya, no se arranca la hoja. Además, un ticket borrado de verdad
   * se lleva la explicación de por qué la cuenta del cliente cambió.
   *
   * Los anulados siguen viniendo en las consultas, pero NO suman a la factura:
   * `recalcularFactura` los saltea.
   */
  anulado: boolean;
  anuladoEl?: Date;
  motivoAnulacion?: string;

  createdAt: Date;
  updatedAt: Date;
}

export type TicketDocument = HydratedDocument<TicketAtributos>;

/** Lo que quedó debiendo de este ticket. Derivado, para que no pueda desfasarse. */
export const faltanteDe = (t: Pick<TicketAtributos, "total" | "pagado">): number =>
  Math.max(t.total - (t.pagado ?? 0), 0);

const itemSchema = new Schema<ItemTicket>(
  {
    nombre: { type: String, required: true, trim: true },
    talle: { type: String, trim: true },
    especie: { type: Schema.Types.ObjectId, ref: "Especie", required: true },
    especieNombre: { type: String, required: true },
    cantidad: { type: Number, required: true, min: 1 },
    precioUnitario: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true },
  },
  { _id: false }
);

const ticketSchema = new Schema<TicketAtributos>(
  {
    factura: { type: Schema.Types.ObjectId, ref: "Factura", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },
    marca: { type: Schema.Types.ObjectId, ref: "Marca", required: true },

    fecha: { type: Date, default: Date.now },
    items: { type: [itemSchema], required: true },

    total: { type: Number, required: true, min: 0 },
    pagado: { type: Number, default: 0, min: 0 },

    registradoPor: { type: Schema.Types.ObjectId, ref: "Usuario" },

    anulado: { type: Boolean, default: false },
    anuladoEl: { type: Date },
    motivoAnulacion: { type: String, trim: true },
  },
  { timestamps: true }
);

// El front necesita el faltante sin tener que restarlo.
ticketSchema.set("toJSON", {
  transform: (_doc, ret) => ({ ...ret, faltante: faltanteDe(ret) }),
});

ticketSchema.index({ factura: 1, fecha: 1 });
ticketSchema.index({ cliente: 1, fecha: -1 });
// Para las métricas de qué especie se vende más.
ticketSchema.index({ marca: 1, "items.especie": 1, fecha: -1 });

export default mongoose.model<TicketAtributos>("Ticket", ticketSchema);
