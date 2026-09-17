import type { Types } from "mongoose";
import Factura from "../../models/Factura.js";
import { redondearPesos } from "../facturacion.js";
import { diasDeAtraso } from "../cumplimiento.js";
import { claveMes, enPeriodo, mesesDelPeriodo, porcentaje, rangoDe, type Periodo } from "./comun.js";

/**
 * Cumplimiento de pagos: qué tan bien se pagan las facturas.
 *
 * Cada factura tiene su % de cumplimiento (ver services/cumplimiento.ts). Acá
 * se juntan las que ya se pueden juzgar:
 *
 *   a-tiempo   saldada con 100%: todo llegó antes del vencimiento
 *   tarde      saldada, pero con menos de 100%
 *   impaga     venció y todavía debe; su cumplimiento es lo que lleva pagado
 *
 * Quedan afuera:
 *   - las que todavía no vencieron y deben: no se sabe cómo van a terminar
 *   - las que no tuvieron nada fiado: si pagó todo al comprar, no hubo nada
 *     que cumplir, e inflarían el promedio
 *   - las anuladas
 *
 * El período mira el vencimiento ORIGINAL: "de las que vencían en agosto,
 * ¿cómo se pagaron?".
 */

export const RESULTADOS_PAGO = ["a-tiempo", "tarde", "impaga"] as const;
export type ResultadoPago = (typeof RESULTADOS_PAGO)[number];

export interface FacturaEvaluada {
  cliente: Types.ObjectId;
  vence: Date;
  saldo: number;
  cumplimiento: number;
  resultado: ResultadoPago;
  /** Pagada: cuánto después de vencer terminó de pagarla. Impaga: cuánto lleva vencida. */
  diasDeAtraso: number;
  /** Cuándo la terminó de pagar. Null si todavía debe. */
  pagadaEl: Date | null;
}

/**
 * Las facturas que se pueden juzgar, cada una con su resultado. Sin período,
 * todas las de la historia. La usa también "mejores clientes".
 */
export async function evaluarFacturas(
  marca: Types.ObjectId,
  periodo: Periodo | undefined,
  ahora = new Date(),
  clientes?: Types.ObjectId[]
): Promise<FacturaEvaluada[]> {
  const facturas = await Factura.find({
    marca,
    estado: { $ne: "anulada" },
    totalFiado: { $gt: 0 },
    vencimientoOriginal: periodo ? enPeriodo(periodo) : { $exists: true },
    $or: [{ estado: "pagada" }, { vencimientoOriginal: { $lt: ahora } }],
    ...(clientes && { cliente: { $in: clientes } }),
  })
    .select("cliente vencimientoOriginal saldo estado cumplimiento pagadaEl")
    .lean();

  return facturas.flatMap((f): FacturaEvaluada[] => {
    const vence = f.vencimientoOriginal;
    if (!vence) return [];

    const base = { cliente: f.cliente, vence, saldo: f.saldo, cumplimiento: f.cumplimiento ?? 0 };
    if (f.estado !== "pagada") {
      return [{ ...base, resultado: "impaga", diasDeAtraso: diasDeAtraso(ahora, vence), pagadaEl: null }];
    }
    return [
      {
        ...base,
        resultado: base.cumplimiento >= 100 ? "a-tiempo" : "tarde",
        diasDeAtraso: diasDeAtraso(f.pagadaEl ?? vence, vence),
        pagadaEl: f.pagadaEl ?? null,
      },
    ];
  });
}

/** Resume un grupo de facturas: el promedio de cumplimiento y cómo terminaron. */
export function resumirCumplimiento(facturas: FacturaEvaluada[]) {
  let aTiempo = 0;
  let tarde = 0;
  let impagas = 0;
  let diasTarde = 0;
  let saldoImpago = 0;
  let sumaCumplimiento = 0;

  for (const f of facturas) {
    sumaCumplimiento += f.cumplimiento;
    if (f.resultado === "a-tiempo") aTiempo++;
    else if (f.resultado === "tarde") {
      tarde++;
      diasTarde += f.diasDeAtraso;
    } else {
      impagas++;
      saldoImpago += f.saldo;
    }
  }

  const unDecimal = (n: number) => Math.round(n * 10) / 10;

  return {
    evaluadas: facturas.length,
    /** El promedio del % de cumplimiento de cada factura. */
    cumplimientoPromedio: facturas.length ? unDecimal(sumaCumplimiento / facturas.length) : null,
    aTiempo,
    tarde,
    impagas,
    porcentajeATiempo: porcentaje(aTiempo, facturas.length),
    /** De las que se pagaron tarde, cuántos días se pasaron en promedio. */
    diasPromedioDeAtraso: tarde ? unDecimal(diasTarde / tarde) : null,
    saldoImpago: redondearPesos(saldoImpago),
  };
}

export async function pagosATiempo(marca: Types.ObjectId, periodo: Periodo, ahora = new Date()) {
  const evaluadas = await evaluarFacturas(marca, periodo, ahora);

  const porMesDeVencimiento = new Map<string, FacturaEvaluada[]>();
  for (const f of evaluadas) {
    const mes = claveMes(f.vence);
    porMesDeVencimiento.set(mes, [...(porMesDeVencimiento.get(mes) ?? []), f]);
  }

  return {
    periodo: rangoDe(periodo),
    resumen: resumirCumplimiento(evaluadas),
    porMes: mesesDelPeriodo(periodo).map((mes) => ({
      mes,
      ...resumirCumplimiento(porMesDeVencimiento.get(mes) ?? []),
    })),
  };
}
