import mongoose, { Schema, type HydratedDocument, type Types } from "mongoose";
import { VENTANA_POR_DEFECTO, type VentanaPago } from "../utils/fechas.js";

export interface ClienteAtributos {
  nombre: string;
  /** Con qué se identifica a la persona que se lleva fiado. */
  dni: string;
  telefono?: string;
  email?: string;
  direccion?: string;

  /**
   * Cuándo paga este cliente.
   *
   * El ciclo es por cliente, no del negocio: uno paga del 1 al 10 y otro del
   * 20 al 30. De acá sale el vencimiento concreto de cada factura suya.
   */
  ventanaPago: VentanaPago;

  /** Hasta cuánto se le fía. 0 = sin límite. */
  limiteCredito: number;

  administrador: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type ClienteDocument = HydratedDocument<ClienteAtributos>;

const clienteSchema = new Schema<ClienteAtributos>(
  {
    nombre: { type: String, required: true, trim: true },
    dni: { type: String, required: true, trim: true },
    telefono: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    direccion: { type: String, trim: true },

    ventanaPago: {
      desdeDia: { type: Number, min: 1, max: 31, default: VENTANA_POR_DEFECTO.desdeDia },
      hastaDia: { type: Number, min: 1, max: 31, default: VENTANA_POR_DEFECTO.hastaDia },
    },

    limiteCredito: { type: Number, default: 0, min: 0 },

    administrador: { type: Schema.Types.ObjectId, ref: "Usuario", required: true },
  },
  { timestamps: true }
);

// El mismo DNI no se repite dentro de un negocio, pero sí puede estar en otro.
clienteSchema.index({ administrador: 1, dni: 1 }, { unique: true });

export default mongoose.model<ClienteAtributos>("Cliente", clienteSchema);
