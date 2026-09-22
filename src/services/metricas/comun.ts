import type { PipelineStage, Types } from "mongoose";
import Cliente from "../../models/Cliente.js";
import { datosInvalidos } from "../../utils/AppError.js";
import { ZONA_HORARIA } from "../../utils/formato.js";
import { DIA_MS, diaEnZona, inicioDelDiaEnZona } from "../../utils/fechas.js";
import type { Query } from "../../utils/consulta.js";
import { patronDeTexto } from "../../utils/validaciones.js";

/**
 * Lo que comparten las métricas: leer el período y la paginación de la query,
 * las fechas en hora de Argentina y los pedazos de pipeline que se repiten.
 *
 * Ninguna métrica se guarda: se calculan al pedirlas, desde los tickets, las
 * facturas y los pagos. Un número guardado habría que acordarse de
 * recalcularlo en cada cambio, y la "deuda vencida" cambia sola con el
 * calendario, sin que nadie toque nada.
 */

// Leer la query y paginar es de cualquier pantalla, no solo de las métricas:
// vive en utils/consulta.ts y se re-exporta acá para no cambiarle los imports
// a cada métrica.
export {
  leerBooleano,
  leerEntero,
  leerOpcion,
  leerPaginacion,
  leerTexto,
  respuestaPaginada,
  saltear,
  type Paginacion,
  type Query,
} from "../../utils/consulta.js";

export { DIA_MS } from "../../utils/fechas.js";

// ─────────────────────────────────────────────────────────────
// Fechas
//
// Los períodos se cortan en días de Argentina (ver utils/fechas.ts): si
// arrancaran a las 00:00 UTC, las compras del último día del mes anterior
// después de las 21 hs caerían en este mes.

/** "aaaa-mm-dd". Acomoda los desbordes: el mes 0 es diciembre del año anterior. */
const aTexto = (anio: number, mes: number, dia: number): string =>
  new Date(Date.UTC(anio, mes - 1, dia)).toISOString().slice(0, 10);

const partesDeTexto = (texto: string) => texto.split("-").map(Number) as [number, number, number];

/** "aaaa-mm" del mes en que cae la fecha, en hora de Argentina. */
export function claveMes(fecha: Date): string {
  const { anio, mes } = diaEnZona(fecha);
  return aTexto(anio, mes, 1).slice(0, 7);
}

// ─────────────────────────────────────────────────────────────
// Período

/** Sin fechas en la query: el mes en curso y los 5 anteriores. */
export const MESES_POR_DEFECTO = 6;
/** Tope del rango. Más que esto y la serie por mes deja de entrar en un gráfico. */
export const MESES_MAXIMOS = 36;

export interface Periodo {
  /** Los días como se pidieron (o los de por defecto), para devolverlos. */
  desde: string;
  hasta: string;
  /** 00:00 del día `desde`. */
  inicio: Date;
  /** 00:00 del día DESPUÉS de `hasta`: se filtra con $lt, así `hasta` entra entero. */
  fin: Date;
}

function leerDia(query: Query, campo: string): string | undefined {
  const valor = query[campo];
  if (valor === undefined || valor === "") return undefined;

  const texto = typeof valor === "string" ? valor.trim() : "";
  const valido = /^\d{4}-\d{2}-\d{2}$/.test(texto) && aTexto(...partesDeTexto(texto)) === texto;
  if (!valido) {
    throw datosInvalidos(`"${campo}" tiene que ser una fecha aaaa-mm-dd, como 2026-09-01`, { campo });
  }
  return texto;
}

/** `desde` y `hasta` de la query, en aaaa-mm-dd. Los dos días entran. */
export function leerPeriodo(query: Query, ahora = new Date()): Periodo {
  const hoy = diaEnZona(ahora);
  const desde = leerDia(query, "desde") ?? aTexto(hoy.anio, hoy.mes - (MESES_POR_DEFECTO - 1), 1);
  const hasta = leerDia(query, "hasta") ?? aTexto(hoy.anio, hoy.mes, hoy.dia);

  // aaaa-mm-dd se ordena bien como texto.
  if (desde > hasta) {
    throw datosInvalidos('"desde" no puede ser posterior a "hasta"', { desde, hasta });
  }

  const [a1, m1, d1] = partesDeTexto(desde);
  const [a2, m2, d2] = partesDeTexto(hasta);
  if ((a2 - a1) * 12 + (m2 - m1) + 1 > MESES_MAXIMOS) {
    throw datosInvalidos(`El período puede abarcar hasta ${MESES_MAXIMOS} meses`, { desde, hasta });
  }

  return {
    desde,
    hasta,
    inicio: inicioDelDiaEnZona(a1, m1, d1),
    fin: inicioDelDiaEnZona(a2, m2, d2 + 1),
  };
}

/**
 * "aaaa-mm-dd" de un día, acomodando los desbordes: el mes 13 es enero del año
 * siguiente, y el día 0 es el último del mes anterior.
 */
export const fechaTexto = aTexto;

/**
 * Un período armado a mano, sin pasar por la query. Lo usa el resumen del
 * dashboard, que compara este mes contra el anterior.
 */
export function periodoEntre(desde: string, hasta: string): Periodo {
  const [a1, m1, d1] = partesDeTexto(desde);
  const [a2, m2, d2] = partesDeTexto(hasta);
  return {
    desde,
    hasta,
    inicio: inicioDelDiaEnZona(a1, m1, d1),
    fin: inicioDelDiaEnZona(a2, m2, d2 + 1),
  };
}

/** Como leerPeriodo, pero sin `desde` ni `hasta` no hay período: toda la historia. */
export function leerPeriodoOpcional(query: Query, ahora = new Date()): Periodo | undefined {
  const vacio = (campo: string) => query[campo] === undefined || query[campo] === "";
  return vacio("desde") && vacio("hasta") ? undefined : leerPeriodo(query, ahora);
}

/** Lo que se devuelve del período en cada respuesta. */
export const rangoDe = ({ desde, hasta }: Periodo) => ({ desde, hasta });

/** El filtro de fecha para un $match. */
export const enPeriodo = (p: Periodo) => ({ $gte: p.inicio, $lt: p.fin });

/**
 * Los meses "aaaa-mm" entre dos, incluidos los dos y sin huecos. Vacío si el
 * primero es posterior al segundo.
 */
export function mesesEntre(desde: string, hasta: string): string[] {
  const [a1, m1] = partesDeTexto(`${desde.slice(0, 7)}-01`);
  const [a2, m2] = partesDeTexto(`${hasta.slice(0, 7)}-01`);
  const cantidad = (a2 - a1) * 12 + (m2 - m1) + 1;
  return cantidad > 0 ? Array.from({ length: cantidad }, (_, i) => aTexto(a1, m1 + i, 1).slice(0, 7)) : [];
}

/** Todos los meses que toca el período, "aaaa-mm", aunque alguno venga vacío. */
export const mesesDelPeriodo = (p: Periodo): string[] => mesesEntre(p.desde, p.hasta);

/** Cómo se corta el período en una serie. */
export const AGRUPACIONES = ["mes", "semana"] as const;
export type Agrupacion = (typeof AGRUPACIONES)[number];

export interface Tramo {
  /** "2026-04" para un mes; el lunes, "2026-04-06", para una semana. */
  etiqueta: string;
  /** Los días que cubre dentro del período (el primero y el último pueden quedar cortados). */
  desde: string;
  hasta: string;
  /** El instante en que se toma la foto: el final del tramo, o ahora si todavía no terminó. */
  corte: Date;
}

/**
 * El período cortado en meses o en semanas (de lunes a domingo), para las
 * métricas que muestran cómo estaba algo al final de cada tramo. Los tramos
 * que todavía no empezaron no se devuelven.
 */
export function tramosDelPeriodo(p: Periodo, agrupar: Agrupacion, ahora = new Date()): Tramo[] {
  const tope = Math.min(p.fin.getTime(), ahora.getTime());
  const tramos: Tramo[] = [];

  const agregar = (etiqueta: string, primerDia: string, ultimoDia: string) => {
    const desde = primerDia < p.desde ? p.desde : primerDia;
    const hasta = ultimoDia > p.hasta ? p.hasta : ultimoDia;
    const [a1, m1, d1] = partesDeTexto(desde);
    if (inicioDelDiaEnZona(a1, m1, d1).getTime() > ahora.getTime()) return;
    const [a2, m2, d2] = partesDeTexto(hasta);
    const fin = inicioDelDiaEnZona(a2, m2, d2 + 1).getTime();
    tramos.push({ etiqueta, desde, hasta, corte: new Date(Math.min(fin, tope) - 1) });
  };

  if (agrupar === "mes") {
    for (const mes of mesesDelPeriodo(p)) {
      const [a, m] = partesDeTexto(`${mes}-01`);
      agregar(mes, `${mes}-01`, aTexto(a, m + 1, 0));
    }
    return tramos;
  }

  // El lunes de la semana en que cae `desde`.
  const [a, m, d] = partesDeTexto(p.desde);
  const diaSemana = new Date(Date.UTC(a, m - 1, d)).getUTCDay(); // 0 = domingo
  for (let lunes = d - ((diaSemana + 6) % 7); aTexto(a, m, lunes) <= p.hasta; lunes += 7) {
    agregar(aTexto(a, m, lunes), aTexto(a, m, lunes), aTexto(a, m, lunes + 6));
  }
  return tramos;
}

// ─────────────────────────────────────────────────────────────
// Pedazos de pipeline

/** Facturas que deben algo: la activa de cada cliente, si tiene saldo. */
export const filtroDeuda = (marca: Types.ObjectId) => ({
  marca,
  estado: "abierta",
  saldo: { $gt: 0 },
});

/** Tickets que cuentan: los anulados están tachados y no suman. */
export const filtroTickets = (marca: Types.ObjectId, periodo?: Periodo) => ({
  marca,
  anulado: { $ne: true },
  ...(periodo && { fecha: enPeriodo(periodo) }),
});

/** Lo que quedó anotado de un ticket. Igual que `faltanteDe` del modelo. */
export const FALTANTE = { $max: [{ $subtract: ["$total", { $ifNull: ["$pagado", 0] }] }, 0] };

/** "aaaa-mm" de una fecha en hora de Argentina. */
export const mesDe = (campo: string) => ({
  $dateToString: { format: "%Y-%m", date: campo, timezone: ZONA_HORARIA },
});

/** "aaaa-mm-dd" de una fecha en hora de Argentina. */
export const diaDe = (campo: string) => ({
  $dateToString: { format: "%Y-%m-%d", date: campo, timezone: ZONA_HORARIA },
});

/** Días entre dos fechas, con decimales. Se redondea afuera, según el caso. */
export const diasEntre = (desde: unknown, hasta: unknown) => ({
  $divide: [{ $subtract: [hasta, desde] }, DIA_MS],
});

/** Lo que se muestra del cliente en cada renglón de una métrica. */
export const CAMPOS_CLIENTE = { nombre: 1, dni: 1, telefono: 1 } as const;

/** Trae el cliente del renglón. `campo` es la expresión con su _id. */
export const conCliente = (campo = "$_id"): PipelineStage.FacetPipelineStage[] => [
  {
    $lookup: {
      from: Cliente.collection.name,
      let: { id: campo },
      pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$id"] } } }, { $project: CAMPOS_CLIENTE }],
      as: "cliente",
    },
  },
  { $unwind: { path: "$cliente", preserveNullAndEmptyArrays: true } },
];

/**
 * El último documento del cliente en otra colección (su última compra, su
 * último pago), sin los anulados. `idCliente` es la expresión con su _id.
 */
export const ultimoDelCliente = (
  from: string,
  campos: Record<string, 1>,
  as: string,
  idCliente = "$_id"
): PipelineStage.FacetPipelineStage => ({
  $lookup: {
    from,
    let: { id: idCliente },
    pipeline: [
      { $match: { $expr: { $eq: ["$cliente", "$$id"] }, anulado: { $ne: true } } },
      { $sort: { fecha: -1 } },
      { $limit: 1 },
      { $project: { _id: 0, fecha: 1, ...campos } },
    ],
    as,
  },
});

/**
 * Los _id de los clientes de la marca cuyo nombre o DNI contienen el texto.
 * Sin importar mayúsculas ni tildes: "alvarez" encuentra "Álvarez".
 */
export async function clientesQueCoinciden(marca: Types.ObjectId, buscar: string) {
  const patron = patronDeTexto(buscar);
  const clientes = await Cliente.find({ marca, $or: [{ nombre: patron }, { dni: patron }] }).select("_id");
  return clientes.map((c) => c._id);
}

/** Cuánto es `parte` de `total`, con un decimal. Null si no hay base. */
export const porcentaje = (parte: number, total: number): number | null =>
  total > 0 ? Math.round((parte / total) * 1000) / 10 : null;
