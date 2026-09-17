import type { Types } from "mongoose";
import Cliente from "../../models/Cliente.js";
import Factura from "../../models/Factura.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import { redondearPesos } from "../facturacion.js";
import { diaEnZona } from "../../utils/fechas.js";
import { fotosDeDeuda } from "./evolucionDeuda.js";
import { mejoresClientes } from "./mejoresClientes.js";
import { ventasPorEspecie } from "./ventasPorEspecie.js";
import {
  CAMPOS_CLIENTE,
  FALTANTE,
  conCliente,
  diasEntre,
  enPeriodo,
  fechaTexto,
  filtroDeuda,
  filtroTickets,
  periodoEntre,
  porcentaje,
  tramosDelPeriodo,
  ultimoDelCliente,
  type Periodo,
} from "./comun.js";

/**
 * El resumen del dashboard: todo lo que ve el administrador al entrar, en una
 * sola consulta.
 *
 *   cobranza   a quién hay que cobrarle hoy
 *   negocio    cómo viene el mes contra el anterior, y la plata en la calle
 *   masVendido qué se está vendiendo
 *   mejores    a quién cuidar
 *   actividad  lo último que se cargó, para ver qué hizo el otro dueño
 *
 * Va todo junto a propósito: es la primera pantalla que se abre, y seis
 * llamadas separadas la harían tardar seis veces más.
 *
 * Nada de esto mira "hoy" solo: en un negocio que hace unos pocos tickets por
 * semana, una tarjeta "ventas de hoy" muestra $0 casi siempre y parece rota.
 * La ventana corta es de una semana y la comparación es mensual.
 */

export interface OpcionesResumen {
  /** La ventana corta: "la semana". */
  dias: number;
  /** Con cuánta anticipación avisar lo que está por vencer. */
  venceEnDias: number;
  /** Cuántos días sin comprar para contar como que se fue debiendo. */
  diasInactivo: number;
  /** Cuántos meses de curva de deuda. */
  meses: number;
  /** Cuántos renglones trae cada lista corta. */
  limite: number;
}

export const RESUMEN_POR_DEFECTO: OpcionesResumen = {
  dias: 7,
  venceEnDias: 7,
  diasInactivo: 60,
  meses: 6,
  limite: 3,
};

interface Movimiento {
  vendido: number;
  dejado: number;
  fiado: number;
  tickets: number;
  clientes: number;
}

/** Lo que se movió en un período: lo que salió y lo que entró. */
async function movimientoEn(marca: Types.ObjectId, p: Periodo) {
  const [tickets, pagos] = await Promise.all([
    Ticket.aggregate<Movimiento>([
      { $match: filtroTickets(marca, p) },
      {
        $group: {
          _id: null,
          vendido: { $sum: "$total" },
          dejado: { $sum: { $ifNull: ["$pagado", 0] } },
          fiado: { $sum: FALTANTE },
          tickets: { $sum: 1 },
          clientes: { $addToSet: "$cliente" },
        },
      },
      { $project: { vendido: 1, dejado: 1, fiado: 1, tickets: 1, clientes: { $size: "$clientes" } } },
    ]),
    Pago.aggregate<{ pagos: number }>([
      { $match: { marca, anulado: { $ne: true }, fecha: enPeriodo(p) } },
      { $group: { _id: null, pagos: { $sum: "$monto" } } },
    ]),
  ]);

  const t = tickets[0];
  return {
    desde: p.desde,
    hasta: p.hasta,
    vendido: redondearPesos(t?.vendido ?? 0),
    /** Lo que quedó anotado. */
    fiado: redondearPesos(t?.fiado ?? 0),
    /** Todo lo que entró: lo que dejaron en el mostrador más los pagos a cuenta. */
    cobrado: redondearPesos((t?.dejado ?? 0) + (pagos[0]?.pagos ?? 0)),
    tickets: t?.tickets ?? 0,
    clientes: t?.clientes ?? 0,
  };
}

interface Corta<T> {
  clientes: number;
  monto: number;
  top: T[];
}

const cortar = <T>(r: { total?: { clientes: number; monto: number }[]; top?: T[] } | undefined): Corta<T> => ({
  clientes: r?.total?.[0]?.clientes ?? 0,
  monto: redondearPesos(r?.total?.[0]?.monto ?? 0),
  top: r?.top ?? [],
});

/** Las facturas con deuda que caen en un rango de vencimiento, y las peores. */
async function facturasPorVencimiento(
  marca: Types.ObjectId,
  venceEl: Record<string, Date>,
  orden: Record<string, 1 | -1>,
  limite: number,
  ahora: Date
) {
  const [r] = await Factura.aggregate([
    { $match: { ...filtroDeuda(marca), venceEl } },
    { $addFields: { dias: { $ceil: diasEntre("$venceEl", ahora) } } },
    {
      $facet: {
        total: [{ $group: { _id: null, clientes: { $sum: 1 }, monto: { $sum: "$saldo" } } }],
        top: [
          { $sort: orden },
          { $limit: limite },
          ...conCliente("$cliente"),
          {
            $project: {
              _id: 0,
              factura: "$_id",
              cliente: 1,
              saldo: 1,
              venceEl: 1,
              /** Positivo: días de atraso. Negativo: días que faltan. */
              dias: 1,
            },
          },
        ],
      },
    },
  ]);
  return cortar(r);
}

/** Los que deben y hace rato que no vienen: la plata que más fácil se pierde. */
async function seFueronDebiendo(marca: Types.ObjectId, dias: number, limite: number, ahora: Date) {
  const limiteFecha = new Date(ahora.getTime() - dias * 86_400_000);
  const [r] = await Factura.aggregate([
    { $match: filtroDeuda(marca) },
    { $group: { _id: "$cliente", saldo: { $sum: "$saldo" } } },
    ultimoDelCliente(Ticket.collection.name, { total: 1 }, "ultimaCompra"),
    { $addFields: { ultimaCompra: { $ifNull: [{ $arrayElemAt: ["$ultimaCompra", 0] }, null] } } },
    { $match: { $or: [{ ultimaCompra: null }, { "ultimaCompra.fecha": { $lt: limiteFecha } }] } },
    {
      $facet: {
        total: [{ $group: { _id: null, clientes: { $sum: 1 }, monto: { $sum: "$saldo" } } }],
        top: [
          { $sort: { saldo: -1 } },
          { $limit: limite },
          ...conCliente(),
          {
            $project: {
              _id: 0,
              cliente: 1,
              saldo: 1,
              ultimaCompra: 1,
              diasSinComprar: {
                $cond: [
                  { $eq: ["$ultimaCompra", null] },
                  null,
                  { $floor: diasEntre("$ultimaCompra.fecha", ahora) },
                ],
              },
            },
          },
        ],
      },
    },
  ]);
  return { dias, ...cortar(r) };
}

/** Los que ya deben más de lo que se les había puesto como tope. */
async function pasaronElLimite(marca: Types.ObjectId, limite: number) {
  const [r] = await Cliente.aggregate([
    { $match: { marca, limiteCredito: { $gt: 0 } } },
    {
      $lookup: {
        from: Factura.collection.name,
        let: { id: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$cliente", "$$id"] }, estado: "abierta", saldo: { $gt: 0 } } },
          { $group: { _id: null, saldo: { $sum: "$saldo" } } },
        ],
        as: "deuda",
      },
    },
    { $addFields: { saldo: { $ifNull: [{ $arrayElemAt: ["$deuda.saldo", 0] }, 0] } } },
    { $match: { $expr: { $gt: ["$saldo", "$limiteCredito"] } } },
    {
      $facet: {
        total: [{ $group: { _id: null, clientes: { $sum: 1 }, monto: { $sum: "$saldo" } } }],
        top: [
          { $sort: { saldo: -1 } },
          { $limit: limite },
          {
            $project: {
              _id: 0,
              cliente: { _id: "$_id", nombre: "$nombre", dni: "$dni", telefono: "$telefono" },
              saldo: 1,
              limiteCredito: 1,
              excedido: { $subtract: ["$saldo", "$limiteCredito"] },
            },
          },
        ],
      },
    },
  ]);
  return cortar(r);
}

/** Lo último que se cargó, de los dos lados del mostrador. */
async function ultimaActividad(marca: Types.ObjectId, cuantos: number) {
  const activos = { marca, anulado: { $ne: true } };
  const [tickets, pagos] = await Promise.all([
    Ticket.find(activos)
      .sort({ fecha: -1 })
      .limit(cuantos)
      .select("fecha total cliente registradoPor")
      .populate("cliente", CAMPOS_CLIENTE)
      .populate("registradoPor", "nombre"),
    Pago.find(activos)
      .sort({ fecha: -1 })
      .limit(cuantos)
      .select("fecha monto metodoPago cliente registradoPor")
      .populate("cliente", CAMPOS_CLIENTE)
      .populate("registradoPor", "nombre"),
  ]);

  const quien = (u: unknown) => {
    const d = u as { _id?: Types.ObjectId; nombre?: string } | null;
    return d?.nombre ? { _id: d._id, nombre: d.nombre } : null;
  };

  return [
    ...tickets.map((t) => ({
      tipo: "compra" as const,
      _id: t._id,
      fecha: t.fecha,
      cliente: t.cliente,
      monto: t.total,
      metodoPago: null as string | null,
      registradoPor: quien(t.registradoPor),
    })),
    ...pagos.map((p) => ({
      tipo: "pago" as const,
      _id: p._id,
      fecha: p.fecha,
      cliente: p.cliente,
      monto: p.monto,
      metodoPago: p.metodoPago ?? "efectivo",
      registradoPor: quien(p.registradoPor),
    })),
  ]
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
    .slice(0, cuantos);
}

export async function resumen(marca: Types.ObjectId, opciones: OpcionesResumen, ahora = new Date()) {
  const { dias, venceEnDias, diasInactivo, meses, limite } = opciones;
  const hoy = diaEnZona(ahora);

  // Este mes, del 1 hasta hoy, contra el MISMO tramo del mes pasado: comparar
  // 16 días contra 31 haría ver siempre peor al mes en curso.
  const mes = periodoEntre(fechaTexto(hoy.anio, hoy.mes, 1), fechaTexto(hoy.anio, hoy.mes, hoy.dia));
  const ultimoDiaDelAnterior = new Date(Date.UTC(hoy.anio, hoy.mes - 1, 0)).getUTCDate();
  const anterior = periodoEntre(
    fechaTexto(hoy.anio, hoy.mes - 1, 1),
    fechaTexto(hoy.anio, hoy.mes - 1, Math.min(hoy.dia, ultimoDiaDelAnterior))
  );
  const semana = periodoEntre(fechaTexto(hoy.anio, hoy.mes, hoy.dia - (dias - 1)), mes.hasta);
  const curva = periodoEntre(fechaTexto(hoy.anio, hoy.mes - (meses - 1), 1), mes.hasta);

  const tramos = tramosDelPeriodo(curva, "mes", ahora);
  const cortes = [curva.inicio.getTime() - 1, ...tramos.map((t) => t.corte.getTime())];

  const [
    esteMes,
    mesPasado,
    estaSemana,
    vencido,
    porVencer,
    seFueron,
    limites,
    fotos,
    deudaHoy,
    especies,
    mejores,
    actividad,
  ] = await Promise.all([
    movimientoEn(marca, mes),
    movimientoEn(marca, anterior),
    movimientoEn(marca, semana),
    facturasPorVencimiento(marca, { $lt: ahora }, { saldo: -1 }, limite, ahora),
    facturasPorVencimiento(
      marca,
      { $gte: ahora, $lte: new Date(ahora.getTime() + venceEnDias * 86_400_000) },
      { venceEl: 1 },
      limite,
      ahora
    ),
    seFueronDebiendo(marca, diasInactivo, limite, ahora),
    pasaronElLimite(marca, limite),
    fotosDeDeuda(marca, cortes),
    Factura.aggregate<{ total: number; vencida: number }>([
      { $match: filtroDeuda(marca) },
      {
        $group: {
          _id: null,
          total: { $sum: "$saldo" },
          vencida: { $sum: { $cond: [{ $lt: ["$venceEl", ahora] }, "$saldo", 0] } },
        },
      },
    ]),
    ventasPorEspecie(marca, mes, "monto"),
    mejoresClientes(marca, { orden: "cumplimiento", limite }, ahora),
    ultimaActividad(marca, limite * 2),
  ]);

  const deuda = deudaHoy[0];
  const alInicio = redondearPesos(fotos[0]!.deuda);

  return {
    generadoEl: ahora,
    cobranza: {
      /** Lo que ya venció y sigue impago: la lista para salir a cobrar. */
      vencido,
      /** Lo que vence en los próximos días: para avisar antes. */
      porVencer: { dias: venceEnDias, ...porVencer },
      /** Deben y hace rato que no compran. */
      seFueronDebiendo: seFueron,
      /** Ya deben más de su límite de crédito. */
      pasaronElLimite: limites,
    },
    negocio: {
      mes: esteMes,
      mesAnterior: mesPasado,
      /** Cuánto cambió respecto del mismo tramo del mes pasado, en %. */
      variacion: {
        vendido: porcentaje(esteMes.vendido - mesPasado.vendido, mesPasado.vendido),
        cobrado: porcentaje(esteMes.cobrado - mesPasado.cobrado, mesPasado.cobrado),
      },
      semana: { dias, ...estaSemana },
      deuda: {
        total: redondearPesos(deuda?.total ?? 0),
        vencida: redondearPesos(deuda?.vencida ?? 0),
        alInicioDeLaCurva: alInicio,
        variacion: redondearPesos((deuda?.total ?? 0) - alInicio),
        porMes: tramos.map((tramo, k) => ({
          mes: tramo.etiqueta,
          deudaTotal: redondearPesos(fotos[k + 1]!.deuda),
          deudaVencida: redondearPesos(fotos[k + 1]!.deudaVencida),
          deudores: fotos[k + 1]!.deudores.size,
        })),
      },
    },
    /** Lo más vendido del mes, por plata. */
    masVendido: especies.especies.slice(0, limite).map((e) => ({
      especie: e.especie,
      unidades: e.unidades,
      monto: e.monto,
      porcentajeMonto: e.porcentajeMonto,
    })),
    /** Los que mejor pagan, de toda su historia. */
    mejoresClientes: mejores.clientes.map((c) => ({
      posicion: c.posicion,
      cliente: c.cliente,
      cumplimiento: c.cumplimiento.cumplimientoPromedio,
      evaluadas: c.cumplimiento.evaluadas,
      comprado: c.comprado,
    })),
    actividad,
  };
}
