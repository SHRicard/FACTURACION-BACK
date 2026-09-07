import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * La cuenta del cliente para un período.
 *
 * A diferencia de un comprobante fiscal, acá la factura **nace abierta** y los
 * tickets se le van pegando. Cuando llega el vencimiento se cierra y hay que
 * pagarla. Es el modelo del resumen de tarjeta: siempre hay un período abierto.
 *
 * "vencida" NO es un estado guardado, se calcula con `venceEl`. Si fuera un
 * estado, alguien tendría que ir a marcarlo y las facturas de clientes que
 * dejaron de comprar quedarían para siempre como al día.
 */
export const ESTADOS_FACTURA = ["abierta", "cerrada", "pagada", "anulada"] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

export interface FacturaAtributos {
  /**
   * Correlativo por negocio. Se asigna AL CERRAR, no al abrir: si no, un
   * cliente que se dio de alta y nunca compró se lleva un número.
   */
  numero?: number;

  administrador: Types.ObjectId;
  cliente: Types.ObjectId;

  estado: EstadoFactura;

  /** Cuándo se abrió el período. */
  desde: Date;
  /** Hasta cuándo tiene tiempo de pagar. Sale de la ventana del cliente. */
  venceEl: Date;
  cerradaEl?: Date;
  pagadaEl?: Date;

  // --- Totales. Los recalcula el servicio ante cada cambio. ---
  cantidadTickets: number;
  /** Valor de la mercadería que se llevó. */
  totalMercaderia: number;
  /** Lo que fue dejando en el momento de cada compra. */
  totalPagadoEnTickets: number;
  /** Suma de los faltantes: lo que quedó anotado. */
  totalFiado: number;
  /** Pagos sueltos imputados a esta factura. */
  totalPagos: number;
  /** Lo que debe: totalFiado - totalPagos. */
  saldo: number;

  createdAt: Date;
  updatedAt: Date;
}

export type FacturaDocument = HydratedDocument<FacturaAtributos>;

const facturaSchema = new Schema<FacturaAtributos>(
  {
    numero: { type: Number },

    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },

    estado: { type: String, enum: ESTADOS_FACTURA, default: "abierta" },

    desde: { type: Date, required: true },
    venceEl: { type: Date, required: true },
    cerradaEl: { type: Date },
    pagadaEl: { type: Date },

    cantidadTickets: { type: Number, default: 0 },
    totalMercaderia: { type: Number, default: 0 },
    totalPagadoEnTickets: { type: Number, default: 0 },
    totalFiado: { type: Number, default: 0 },
    totalPagos: { type: Number, default: 0 },
    saldo: { type: Number, default: 0 },
  },
  { timestamps: true }
);

/**
 * Un cliente tiene como mucho UNA factura abierta.
 *
 * El índice parcial lo garantiza en la base, no solo en el código: aunque dos
 * requests intenten abrir una a la vez, Mongo rechaza la segunda.
 */
facturaSchema.index(
  { cliente: 1, estado: 1 },
  { unique: true, partialFilterExpression: { estado: "abierta" } }
);

/**
 * El correlativo no se repite dentro de un negocio.
 *
 * Va con partialFilterExpression y NO con `sparse`: en un índice compuesto,
 * `sparse` solo saltea el documento si le faltan TODOS los campos indexados.
 * Como `administrador` siempre está, las facturas todavía sin número se
 * indexaban como (administrador, null) y la segunda chocaba con la primera.
 */
facturaSchema.index(
  { administrador: 1, numero: 1 },
  { unique: true, partialFilterExpression: { numero: { $type: "number" } } }
);
// Buscar las vencidas: filtra por fecha, sin depender de que alguien las marque.
facturaSchema.index({ administrador: 1, venceEl: 1, estado: 1 });

export default mongoose.model<FacturaAtributos>("Factura", facturaSchema);
