/** Chequeo de forma, no de existencia: que tenga algo@algo.algo. */
export const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Escapa lo que el usuario tipeó para que no se interprete como regex. */
export const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Saca las tildes: "Álvarez" queda "Alvarez". */
const sinTildes = (texto: string): string => texto.normalize("NFD").replace(/\p{M}/gu, "");

// Cada letra busca también sus versiones con tilde. Nadie escribe "Álvarez"
// en el buscador, y "Alvarez" tiene que encontrarlo igual.
const CON_TILDE: Record<string, string> = {
  a: "aáàä",
  e: "eéèë",
  i: "iíìï",
  o: "oóòö",
  u: "uúùü",
  n: "nñ",
  c: "cç",
};

/**
 * Patrón para buscar texto escrito por el usuario, sin importar mayúsculas ni
 * tildes: "alvarez" encuentra "Álvarez", y "Álvarez" también.
 */
export function patronDeTexto(texto: string): RegExp {
  const patron = [...escaparRegex(sinTildes(texto).toLowerCase())]
    .map((letra) => (CON_TILDE[letra] ? `[${CON_TILDE[letra]}]` : letra))
    .join("");
  return new RegExp(patron, "i");
}

/**
 * DNI del usuario: "30.111.222" o "30111222" quedan como "30111222". Null si
 * no tiene 7 u 8 números. Se guarda normalizado, así el mismo DNI escrito
 * con o sin puntos no pasa como dos personas distintas.
 */
export function normalizarDni(crudo: unknown): string | null {
  if (typeof crudo !== "string" && typeof crudo !== "number") return null;
  const digitos = String(crudo).replace(/[\s.\-]/g, "");
  return /^\d{7,8}$/.test(digitos) ? digitos : null;
}

/**
 * Color hex: "#4A1866" o "4a1866" quedan como "#4a1866", y "#abc" como
 * "#aabbcc". Null si no es un hex de 3 o 6 dígitos. Se guarda siempre igual,
 * así el front puede comparar sin normalizar.
 */
export function normalizarColor(crudo: unknown): string | null {
  if (typeof crudo !== "string") return null;
  const hex = crudo.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}
