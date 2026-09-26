import type { Model } from "mongoose";
import Usuario from "../../models/Usuario.js";
import Marca from "../../models/Marca.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import { diaEnZona, inicioDelDiaEnZona } from "../../utils/fechas.js";
import { leerEntero, leerOpcion, type Query } from "../../utils/consulta.js";
import { diaDe, fechaTexto, mesDe } from "../metricas/comun.js";
import { redondear } from "./comun.js";

/**
 * GET /admin/crecimiento — cómo crece la plataforma, tramo por tramo: altas
 * de usuarios y marcas, y tickets, pagos y plata cargados.
 *
 * Por día (los últimos `dias`, por defecto 30) o por mes (los últimos
 * `meses`, por defecto 12). Los tramos sin movimiento vienen en cero, así el
 * gráfico no tiene huecos. Todo en hora de Argentina y por fecha de CARGA
 * (createdAt): mide el uso de la app, no la fecha que eligió el kiosquero.
 */

const AGRUPACIONES = ["dia", "mes"] as const;

type Fila = { _id: string; n: number; monto?: number; extra?: number };

async function contarPorTramo(
  modelo: Model<any>,
  inicio: Date,
  tramo: object,
  opciones: { match?: object; monto?: string; extra?: string } = {}
): Promise<Map<string, Fila>> {
  const filas = await modelo.aggregate<Fila>([
    { $match: { createdAt: { $gte: inicio }, ...opciones.match } },
    {
      $group: {
        _id: tramo,
        n: { $sum: 1 },
        ...(opciones.monto && { monto: { $sum: opciones.monto } }),
        ...(opciones.extra && { extra: { $sum: opciones.extra } }),
      },
    },
  ]);
  return new Map(filas.map((f) => [f._id, f]));
}

export async function crecimientoPlataforma(query: Query, ahora = new Date()) {
  const agrupar = leerOpcion(query, "agrupar", AGRUPACIONES, "dia");
  const hoy = diaEnZona(ahora);

  let claves: string[];
  let inicio: Date;
  if (agrupar === "dia") {
    const dias = leerEntero(query, "dias", { defecto: 30, min: 1, max: 180 });
    claves = Array.from({ length: dias }, (_, i) => fechaTexto(hoy.anio, hoy.mes, hoy.dia - (dias - 1) + i));
    inicio = inicioDelDiaEnZona(hoy.anio, hoy.mes, hoy.dia - (dias - 1));
  } else {
    const meses = leerEntero(query, "meses", { defecto: 12, min: 1, max: 36 });
    claves = Array.from({ length: meses }, (_, i) =>
      fechaTexto(hoy.anio, hoy.mes - (meses - 1) + i, 1).slice(0, 7)
    );
    inicio = inicioDelDiaEnZona(hoy.anio, hoy.mes - (meses - 1), 1);
  }

  const tramo = agrupar === "dia" ? diaDe("$createdAt") : mesDe("$createdAt");
  const activos = { anulado: { $ne: true } };

  const [usuarios, marcas, tickets, pagos] = await Promise.all([
    contarPorTramo(Usuario, inicio, tramo, { match: { rol: "administrador" } }),
    contarPorTramo(Marca, inicio, tramo),
    contarPorTramo(Ticket, inicio, tramo, { match: activos, monto: "$total", extra: "$pagado" }),
    contarPorTramo(Pago, inicio, tramo, { match: activos, monto: "$monto" }),
  ]);

  const serie = claves.map((periodo) => {
    const t = tickets.get(periodo);
    const p = pagos.get(periodo);
    return {
      periodo,
      usuarios: usuarios.get(periodo)?.n ?? 0,
      marcas: marcas.get(periodo)?.n ?? 0,
      tickets: t?.n ?? 0,
      pagos: p?.n ?? 0,
      vendido: redondear(t?.monto ?? 0),
      cobrado: redondear((t?.extra ?? 0) + (p?.monto ?? 0)),
    };
  });

  const totales = serie.reduce(
    (acc, s) => ({
      usuarios: acc.usuarios + s.usuarios,
      marcas: acc.marcas + s.marcas,
      tickets: acc.tickets + s.tickets,
      pagos: acc.pagos + s.pagos,
      vendido: redondear(acc.vendido + s.vendido),
      cobrado: redondear(acc.cobrado + s.cobrado),
    }),
    { usuarios: 0, marcas: 0, tickets: 0, pagos: 0, vendido: 0, cobrado: 0 }
  );

  return { agrupar, desde: claves[0], hasta: claves[claves.length - 1], serie, totales };
}
