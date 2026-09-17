import { datosInvalidos } from "./AppError.js";

/**
 * Leer la query de una request: paginación, opciones de una lista cerrada,
 * números y textos.
 *
 * Vive acá y no en las métricas porque lo usa cualquier pantalla que liste
 * cosas (el historial del cliente, por ejemplo). Todo lo que no sirve tira un
 * 400 con `detalles.campo`, así el front sabe qué campo corregir sin leer el
 * mensaje.
 */

/** La query de Express, sin atarse a su tipo. */
export type Query = Record<string, unknown>;

const POR_PAGINA_DEFECTO = 20;
const POR_PAGINA_MAXIMO = 100;

export interface Paginacion {
  pagina: number;
  porPagina: number;
}

export function leerPaginacion(query: Query): Paginacion {
  return {
    pagina: Math.max(1, Number(query["pagina"]) || 1),
    porPagina: Math.min(POR_PAGINA_MAXIMO, Math.max(1, Number(query["porPagina"]) || POR_PAGINA_DEFECTO)),
  };
}

export const saltear = (p: Paginacion): number => (p.pagina - 1) * p.porPagina;

/** Misma forma que los listados de clientes y facturas. */
export const respuestaPaginada = <T>(datos: T[], total: number, p: Paginacion) => ({
  datos,
  total,
  pagina: p.pagina,
  porPagina: p.porPagina,
  paginas: Math.ceil(total / p.porPagina) || 1,
});

export function leerEntero(
  query: Query,
  campo: string,
  { defecto, min, max }: { defecto: number; min: number; max: number }
): number {
  const valor = query[campo];
  if (valor === undefined || valor === "") return defecto;

  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < min || numero > max) {
    throw datosInvalidos(`"${campo}" tiene que ser un número entero entre ${min} y ${max}`, { campo });
  }
  return numero;
}

/** Un valor de una lista cerrada. Sin `defecto`, puede no venir. */
export function leerOpcion<T extends string>(query: Query, campo: string, opciones: readonly T[], defecto: T): T;
export function leerOpcion<T extends string>(query: Query, campo: string, opciones: readonly T[]): T | undefined;
export function leerOpcion<T extends string>(
  query: Query,
  campo: string,
  opciones: readonly T[],
  defecto?: T
): T | undefined {
  const valor = query[campo];
  if (valor === undefined || valor === "") return defecto;

  if (!opciones.includes(valor as T)) {
    throw datosInvalidos(`"${campo}" inválido. Los válidos son: ${opciones.join(", ")}`, {
      campo,
      validos: opciones,
    });
  }
  return valor as T;
}

export const leerTexto = (query: Query, campo: string): string =>
  typeof query[campo] === "string" ? (query[campo] as string).trim() : "";

export const leerBooleano = (query: Query, campo: string): boolean => query[campo] === "true";
