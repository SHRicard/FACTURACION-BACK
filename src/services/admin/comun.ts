import { Types } from "mongoose";
import { DIA_MS, diaEnZona, inicioDelDiaEnZona } from "../../utils/fechas.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../../legal/documentos.js";
import { noEncontrado } from "../../utils/AppError.js";

/**
 * Lo que comparten las pantallas del super_admin (/admin).
 *
 * Todo se calcula al pedirlo, igual que las métricas de la marca: nada de
 * esto se guarda. La única excepción son las estadísticas de cada marca, que
 * ya vienen recalculadas en `marca.estadisticas` (ver services/marcas.ts).
 */

/** El instante de hace `dias` días. Para "activos en los últimos 30 días". */
export const haceDias = (dias: number, ahora = new Date()): Date =>
  new Date(ahora.getTime() - dias * DIA_MS);

/** 00:00 de hoy en hora de Argentina. */
export function inicioDeHoy(ahora = new Date()): Date {
  const { anio, mes, dia } = diaEnZona(ahora);
  return inicioDelDiaEnZona(anio, mes, dia);
}

/** Un id de la URL. Uno mal formado es lo mismo que uno que no existe. */
export function exigirId(crudo: unknown, que: string, genero: "o" | "a" = "o"): Types.ObjectId {
  const texto = String(crudo ?? "");
  if (!Types.ObjectId.isValid(texto)) throw noEncontrado(que, genero);
  return new Types.ObjectId(texto);
}

// ─────────────────────────────────────────────────────────────
// Qué le falta a cada usuario (el `pendiente` de middleware/marca.ts, en Mongo)

export const ESTADOS_ONBOARDING = ["terminos", "perfil", "marca", "listo"] as const;
export type EstadoOnboarding = (typeof ESTADOS_ONBOARDING)[number];

const sinTerminos = {
  $or: [
    { aceptoTerminosYCondiciones: { $ne: true } },
    { terminosYCondicionesVersion: { $ne: VERSION_DOCUMENTOS_LEGALES } },
  ],
};
const conTerminos = {
  aceptoTerminosYCondiciones: true,
  terminosYCondicionesVersion: VERSION_DOCUMENTOS_LEGALES,
};
const sinDni = { $or: [{ dni: null }, { dni: "" }] };
const conDni = { dni: { $type: "string", $ne: "" } };

/**
 * El filtro de Mongo para cada paso del onboarding. Mismo orden que
 * pendienteDe(): primero términos, después DNI, después marca. El super_admin
 * nunca tiene pendiente, así que solo se miran administradores.
 */
export function filtroOnboarding(estado: EstadoOnboarding): Record<string, unknown> {
  const admin = { rol: "administrador" };
  switch (estado) {
    case "terminos":
      return { ...admin, ...sinTerminos };
    case "perfil":
      return { ...admin, ...conTerminos, ...sinDni };
    case "marca":
      return { ...admin, ...conTerminos, ...conDni, marca: null };
    case "listo":
      return { ...admin, ...conTerminos, ...conDni, marca: { $ne: null } };
  }
}

export const redondear = (n: number): number => Math.round(n * 100) / 100;
