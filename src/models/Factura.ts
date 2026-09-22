import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";

/**
 * La cuenta del cliente: lo que se lleva fiado, hasta que lo termina de pagar.
 *
 * El cliente tiene UNA factura activa (abierta) a la vez. Los tickets se le
 * van sumando aunque ya haya vencido: vencer no la cierra, solo dice que no
 * cumplió. Se cierra (pagada) cuando un pago la deja en cero, y recién ahí la
 * próxima compra abre otra. Las pagadas quedan como registro, cada una con su
 * cumplimiento.
 *
 * "vencida" NO es un estado guardado, se calcula con `venceEl`. Si fuera un
 * estado, alguien tendría que ir a marcarlo y las facturas de clientes que
 * dejaron de comprar quedarían para siempre como al día.
 */
export const ESTADOS_FACTURA = ["abierta", "pagada", "anulada"] as const;
export type EstadoFactura = (typeof ESTADOS_FACTURA)[number];

export interface FacturaAtributos {
  /**
   * Correlativo por negocio. Se asigna AL SALDARLA, no al abrir: si no, un
   * cliente que se dio de alta y nunca compró se lleva un número.
   */
  numero?: number;

  /** De qué marca es: la ven y la manejan todos sus dueños. */
  marca: Types.ObjectId;
  cliente: Types.ObjectId;

  estado: EstadoFactura;

  /** Cuándo empezó: el primer ticket. */
  desde: Date;
  /**
   * Hasta cuándo tiene para pagar. Se fija con el primer ticket (la fecha que
   * acordó el administrador, o la de la ventana del cliente) y se puede
   * reprogramar.
   */
  venceEl: Date;
  /**
   * El primer vencimiento acordado. No cambia al reprogramar: contra este se
   * mide el cumplimiento, así una fecha nueva no borra el atraso.
   */
  vencimientoOriginal?: Date;
  /**
   * Cuándo se reprogramó por última vez. La métrica de morosos lo usa para
   * saber qué fecha valía en cada momento: antes de esto, la original.
   */
  reprogramadaEl?: Date;
  /** Cuándo la terminó de pagar. */
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
  /** Cuántos pagos sueltos recibió, sin contar los anulados. */
  cantidadPagos: number;
  /** Fecha del último pago suelto que no esté anulado. */
  ultimoPagoEl?: Date | null;
  /** Lo que debe: totalFiado - totalPagos. */
  saldo: number;
  /**
   * Qué tan bien pagó, de 0 a 100 (ver services/cumplimiento.ts). Null si no
   * hubo nada fiado. Mientras está abierta cambia con cada pago; al saldarse
   * queda fijo.
   */
  cumplimiento?: number | null;

  /**
   * Versión de los links públicos. Va adentro de cada link que se manda; al
   * subirla, todos los links anteriores dejan de abrir.
   */
  versionEnlace?: number;

  /**
   * Contador de escrituras de los totales y del estado. No hay transacciones
   * (Mongo standalone), así que recalcularFactura, saldarFactura y
   * reabrirFactura escriben solo si nadie escribió desde que leyeron, y si no,
   * vuelven a leer. Las facturas de antes no lo tienen guardado: para ellas
   * vale 0.
   */
  revision: number;

  createdAt: Date;
  updatedAt: Date;
}

export type FacturaDocument = HydratedDocument<FacturaAtributos>;

const facturaSchema = new Schema<FacturaAtributos>(
  {
    numero: { type: Number },

    marca: { type: Schema.Types.ObjectId, ref: "Marca", required: true },
    cliente: { type: Schema.Types.ObjectId, ref: "Cliente", required: true },

    estado: { type: String, enum: ESTADOS_FACTURA, default: "abierta" },

    desde: { type: Date, required: true },
    venceEl: { type: Date, required: true },
    vencimientoOriginal: { type: Date },
    reprogramadaEl: { type: Date },
    pagadaEl: { type: Date },

    cantidadTickets: { type: Number, default: 0 },
    totalMercaderia: { type: Number, default: 0 },
    totalPagadoEnTickets: { type: Number, default: 0 },
    totalFiado: { type: Number, default: 0 },
    totalPagos: { type: Number, default: 0 },
    cantidadPagos: { type: Number, default: 0 },
    ultimoPagoEl: { type: Date },
    saldo: { type: Number, default: 0 },
    cumplimiento: { type: Number, default: null },

    versionEnlace: { type: Number, default: 0 },
    revision: { type: Number, default: 0 },
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
 * El correlativo no se repite dentro de una marca: con dos dueños, la 0001 la
 * salda uno y la 0002 el otro, pero es una sola numeración.
 *
 * Va con partialFilterExpression y NO con `sparse`: en un índice compuesto,
 * `sparse` solo saltea el documento si le faltan TODOS los campos indexados.
 * Como `marca` siempre está, las facturas todavía sin número se indexarían
 * como (marca, null) y la segunda chocaría con la primera.
 */
facturaSchema.index(
  { marca: 1, numero: 1 },
  { unique: true, partialFilterExpression: { numero: { $type: "number" } } }
);
// Buscar las vencidas: filtra por fecha, sin depender de que alguien las marque.
facturaSchema.index({ marca: 1, venceEl: 1, estado: 1 });
// Las métricas de cumplimiento miran el vencimiento original.
facturaSchema.index({ marca: 1, vencimientoOriginal: 1 });

export default mongoose.model<FacturaAtributos>("Factura", facturaSchema);
