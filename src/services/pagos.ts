import mongoose, { type Types } from "mongoose";
import Factura, { type FacturaDocument } from "../models/Factura.js";
import Pago, { METODOS_PAGO, type MetodoPago, type PagoDocument } from "../models/Pago.js";
import type { ClienteDocument } from "../models/Cliente.js";
import { datosInvalidos } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import {
  ajustarEstadoPorSaldo,
  deudaTotalDe,
  exigirQueSePuedaReabrir,
  recalcularFactura,
  redondearPesos,
  serializarFactura,
} from "./facturacion.js";

/**
 * Registrar lo que el cliente deja a cuenta.
 *
 * Hay dos puertas y un solo motor:
 *
 *   POST /clientes/:id/pagos   "dejó $20.000"   → va a su factura activa
 *   POST /facturas/:id/pagos   desde la factura → va a esa factura
 *
 * El cliente tiene una sola factura con deuda, así que las dos terminan en el
 * mismo lugar. Las dos pasan por `aplicar`, que guarda el pago con la foto de
 * cuánto debía y cuánto quedó. Si el pago la deja en cero, la factura se
 * cierra (ver ajustarEstadoPorSaldo).
 */

// Solo la activa cobra: la pagada ya está en cero y la anulada no cuenta.
const ESTADOS_QUE_COBRAN = ["abierta"] as const;

export interface DatosPago {
  monto: number;
  metodoPago: MetodoPago;
  nota?: string;
}

/** Valida lo que manda el front. No toca la base: o devuelve todo bien, o tira. */
export function leerDatosPago(body: Record<string, unknown> | undefined): DatosPago {
  const monto = redondearPesos(Number(body?.["monto"]));
  if (!Number.isFinite(monto) || monto <= 0) {
    throw datosInvalidos("El monto del pago tiene que ser mayor a 0");
  }

  // Vacío o ausente es efectivo, que es el caso de todos los días.
  const metodoPago = body?.["metodoPago"] || "efectivo";
  if (!METODOS_PAGO.includes(metodoPago as MetodoPago)) {
    throw datosInvalidos(`Método de pago inválido. Los válidos son: ${METODOS_PAGO.join(", ")}`, {
      metodoPago,
      validos: METODOS_PAGO,
    });
  }

  const nota = typeof body?.["nota"] === "string" ? body["nota"].trim() : "";
  if (nota.length > 300) throw datosInvalidos("La nota puede tener hasta 300 caracteres");

  return { monto, metodoPago: metodoPago as MetodoPago, ...(nota && { nota }) };
}

/**
 * Descuenta la plata de las facturas en el orden en que vienen y guarda un
 * pago por cada una que tocó. El monto ya tiene que venir validado contra la
 * deuda: acá no sobra nada.
 */
async function aplicar(
  facturas: FacturaDocument[],
  datos: DatosPago,
  cliente: Types.ObjectId,
  usuario: Types.ObjectId
) {
  const entrega = new mongoose.Types.ObjectId();
  const fecha = new Date();
  let resto = datos.monto;

  const renglones = [];
  for (const factura of facturas) {
    if (resto <= 0) break;

    const monto = redondearPesos(Math.min(resto, factura.saldo));
    renglones.push({
      factura: factura._id,
      cliente,
      marca: factura.marca,
      fecha,
      monto,
      metodoPago: datos.metodoPago,
      nota: datos.nota,
      entrega,
      montoEntrega: datos.monto,
      saldoAnterior: factura.saldo,
      saldoPosterior: redondearPesos(factura.saldo - monto),
      registradoPor: usuario,
    });
    resto = redondearPesos(resto - monto);
  }

  const pagos = await Pago.insertMany(renglones);

  // Los totales se derivan siempre del recálculo, nunca se restan a mano.
  const actualizadas = await Promise.all(
    pagos.map(async (p) => ajustarEstadoPorSaldo(await recalcularFactura(p.factura)))
  );

  return { entrega, fecha, pagos, facturas: actualizadas };
}

/** La respuesta de las dos puertas: misma forma, así el front tiene un solo manejo. */
async function respuesta(
  resultado: Awaited<ReturnType<typeof aplicar>>,
  datos: DatosPago,
  saldoAnterior: number,
  clienteId: Types.ObjectId
) {
  const saldoPosterior = redondearPesos(saldoAnterior - datos.monto);

  return {
    entrega: {
      _id: resultado.entrega,
      fecha: resultado.fecha,
      monto: datos.monto,
      metodoPago: datos.metodoPago,
      nota: datos.nota,
      saldoAnterior,
      saldoPosterior,
      tipo: saldoPosterior <= 0 ? "completo" : "parcial",
      cantidadFacturas: resultado.pagos.length,
    },
    pagos: resultado.pagos,
    facturas: resultado.facturas.map(serializarFactura),
    deudaTotal: await deudaTotalDe(clienteId),
  };
}

/**
 * "Dejó $20.000": va a lo que debe, que es su factura activa.
 *
 * Se busca como lista y de la más vieja a la más nueva por si quedaron datos
 * de antes de "una sola factura con deuda": ahí se salda primero lo más viejo.
 */
export async function registrarPagoDeCliente(
  cliente: ClienteDocument,
  datos: DatosPago,
  usuario: Types.ObjectId
) {
  const facturas = await Factura.find({
    cliente: cliente._id,
    estado: { $in: ESTADOS_QUE_COBRAN },
    saldo: { $gt: 0 },
  }).sort({ venceEl: 1, createdAt: 1 });

  const deuda = redondearPesos(facturas.reduce((t, f) => t + f.saldo, 0));

  if (deuda <= 0) {
    throw datosInvalidos(`${cliente.nombre} no debe nada`, { deuda: 0 });
  }
  if (datos.monto > deuda) {
    throw datosInvalidos(`Está dejando más de lo que debe. La deuda es de $${deuda}`, {
      deuda,
      monto: datos.monto,
    });
  }

  const resultado = await aplicar(facturas, datos, cliente._id, usuario);
  logger.info(
    `Pago de ${cliente.nombre}: $${datos.monto} en ${resultado.pagos.length} factura(s)`
  );

  return respuesta(resultado, datos, deuda, cliente._id);
}

/** Desde la pantalla de la factura: todo va a esa factura. */
export async function registrarPagoDeFactura(
  factura: FacturaDocument,
  datos: DatosPago,
  usuario: Types.ObjectId
) {
  if (!ESTADOS_QUE_COBRAN.includes(factura.estado as (typeof ESTADOS_QUE_COBRAN)[number])) {
    throw datosInvalidos(`La factura está ${factura.estado}, no recibe pagos`, {
      estadoFactura: factura.estado,
    });
  }
  if (factura.saldo <= 0) {
    throw datosInvalidos("La factura no tiene saldo pendiente", { saldo: factura.saldo });
  }
  if (datos.monto > factura.saldo) {
    throw datosInvalidos(
      `Está dejando más de lo que debe esta factura. El saldo es de $${factura.saldo}`,
      { saldo: factura.saldo, monto: datos.monto }
    );
  }

  const resultado = await aplicar([factura], datos, factura.cliente, usuario);
  return respuesta(resultado, datos, factura.saldo, factura.cliente);
}

/**
 * Anula un pago cargado por error. Baja lógica: queda tachado y deja de
 * descontar.
 *
 * Se anula la entrega entera, no solo este renglón: si se tipeó $20.000 en vez
 * de $2.000, está mal en todas las facturas que tocó esa plata.
 */
export async function anularPago(pago: PagoDocument, motivo?: string) {
  if (pago.anulado) throw datosInvalidos("El pago ya está anulado");

  const pagos = pago.entrega
    ? await Pago.find({ entrega: pago.entrega, anulado: { $ne: true } })
    : [pago];
  const ids = pagos.map((p) => p._id);

  const facturas = await Factura.find({ _id: { $in: pagos.map((p) => p.factura) } });
  if (facturas.some((f) => f.estado === "anulada")) {
    throw datosInvalidos("No se puede anular un pago de una factura anulada");
  }
  // Si este pago saldó la factura, al anularlo vuelve a deber: se chequea
  // antes de tocar nada que eso no le deje al cliente dos facturas con deuda.
  for (const f of facturas) await exigirQueSePuedaReabrir(f);

  await Pago.updateMany(
    { _id: { $in: ids } },
    { anulado: true, anuladoEl: new Date(), ...(motivo && { motivoAnulacion: motivo }) }
  );

  // Una factura saldada con este pago vuelve a abierta: vuelve a deber.
  const actualizadas = await Promise.all(
    facturas.map(async (f) => ajustarEstadoPorSaldo(await recalcularFactura(f._id)))
  );

  return {
    mensaje: ids.length > 1 ? `Pago anulado en ${ids.length} facturas` : "Pago anulado",
    pagos: await Pago.find({ _id: { $in: ids } }),
    facturas: actualizadas.map(serializarFactura),
    deudaTotal: await deudaTotalDe(pago.cliente),
  };
}
