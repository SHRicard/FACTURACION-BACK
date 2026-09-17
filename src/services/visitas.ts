import { DIA_MS, diaEnZona } from "../utils/fechas.js";

/**
 * Cada cuántos días vuelve un cliente, en promedio.
 *
 * Se cuentan visitas y no tickets: dos tickets el mismo día son una sola vez
 * que vino. Mismo criterio que la métrica de frecuencia de compra, y lo usan
 * también el historial y el perfil del cliente.
 *
 * Null con menos de dos visitas: con una sola compra no hay ritmo que medir.
 */
export function diasEntreCompras(fechas: Date[]): number | null {
  const visitas = new Set(fechas.map((f) => JSON.stringify(diaEnZona(f))));
  if (visitas.size < 2) return null;

  const tiempos = fechas.map((f) => f.getTime());
  const rango = (Math.max(...tiempos) - Math.min(...tiempos)) / DIA_MS;
  return Math.round((rango / (visitas.size - 1)) * 10) / 10;
}
