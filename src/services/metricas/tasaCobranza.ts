import type { Types } from "mongoose";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import { redondearPesos } from "../facturacion.js";
import {
  FALTANTE,
  enPeriodo,
  filtroTickets,
  mesDe,
  mesesDelPeriodo,
  porcentaje,
  rangoDe,
  type Periodo,
} from "./comun.js";

/**
 * Tasa de cobranza: de lo que se fió en el período, cuánto volvió en pagos.
 *
 *   tasa = pagos a cuenta ÷ fiado
 *
 * Por debajo de 100% la libreta crece: se anota más de lo que se cobra. Por
 * encima, se achica. Puede pasar de 100%: los pagos de este mes también
 * cancelan lo fiado en meses anteriores.
 *
 * Lo que el cliente deja al comprar no entra en la tasa: esa plata nunca se
 * fió. Se devuelve aparte (`dejadoAlComprar`) para mostrar todo lo que entró.
 */

interface MesTickets {
  _id: string;
  vendido: number;
  dejado: number;
  fiado: number;
}

interface MesPagos {
  _id: string;
  cobrado: number;
}

function fila(vendido: number, dejado: number, fiado: number, cobrado: number) {
  return {
    vendido: redondearPesos(vendido),
    dejadoAlComprar: redondearPesos(dejado),
    fiado: redondearPesos(fiado),
    cobrado: redondearPesos(cobrado),
    tasa: porcentaje(cobrado, fiado),
    /** Cuánto creció (+) o se achicó (−) la deuda en ese tiempo. */
    variacionDeuda: redondearPesos(fiado - cobrado),
  };
}

export async function tasaCobranza(marca: Types.ObjectId, periodo: Periodo) {
  const [tickets, pagos] = await Promise.all([
    Ticket.aggregate<MesTickets>([
      { $match: filtroTickets(marca, periodo) },
      {
        $group: {
          _id: mesDe("$fecha"),
          vendido: { $sum: "$total" },
          dejado: { $sum: { $ifNull: ["$pagado", 0] } },
          fiado: { $sum: FALTANTE },
        },
      },
    ]),
    Pago.aggregate<MesPagos>([
      { $match: { marca, anulado: { $ne: true }, fecha: enPeriodo(periodo) } },
      { $group: { _id: mesDe("$fecha"), cobrado: { $sum: "$monto" } } },
    ]),
  ]);

  const ticketsDelMes = new Map(tickets.map((t) => [t._id, t]));
  const pagosDelMes = new Map(pagos.map((p) => [p._id, p]));

  const porMes = mesesDelPeriodo(periodo).map((mes) => {
    const t = ticketsDelMes.get(mes);
    return { mes, ...fila(t?.vendido ?? 0, t?.dejado ?? 0, t?.fiado ?? 0, pagosDelMes.get(mes)?.cobrado ?? 0) };
  });

  const sumar = (valores: number[]) => valores.reduce((a, b) => a + b, 0);

  return {
    periodo: rangoDe(periodo),
    total: fila(
      sumar(tickets.map((t) => t.vendido)),
      sumar(tickets.map((t) => t.dejado)),
      sumar(tickets.map((t) => t.fiado)),
      sumar(pagos.map((p) => p.cobrado))
    ),
    porMes,
  };
}
