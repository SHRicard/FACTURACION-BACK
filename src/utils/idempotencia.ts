import { createHash } from "node:crypto";
import type { Request } from "express";
import { AppError } from "./AppError.js";

// Idempotencia de los POST que mueven plata (tickets y pagos).
//
// Sin transacciones (Mongo standalone), la defensa contra el reintento con
// mala señal es una clave por intento de guardado que manda el front en el
// header Idempotency-Key. Se guarda en el documento con un índice único
// parcial, junto con la huella del pedido: si vuelve la misma clave con el
// mismo pedido, se responde lo que ya se había registrado en vez de cargarlo
// dos veces; si vuelve con otros datos, es un 409.

export interface Idempotencia {
  clave: string;
  huella: string;
}

/** El front manda un UUID v4; se acepta cualquier clave de ese estilo. */
const FORMATO_CLAVE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * La clave del header Idempotency-Key, o null si no vino. Es opcional: los
 * clientes viejos o un curl sin el header se comportan como siempre.
 */
export function leerClaveIdempotencia(req: Request): string | null {
  const cruda = req.get("Idempotency-Key");
  if (cruda === undefined || cruda === "") return null;

  const clave = cruda.trim();
  if (!FORMATO_CLAVE.test(clave)) {
    throw new AppError(
      "La clave de idempotencia no es válida",
      400,
      undefined,
      "IDEMPOTENCIA_CLAVE_INVALIDA"
    );
  }
  return clave;
}

function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);

  // Solo los objetos planos se rearman. Date y ObjectId pasan igual y se
  // serializan con su toJSON.
  if (
    valor !== null &&
    typeof valor === "object" &&
    Object.getPrototypeOf(valor) === Object.prototype
  ) {
    const plano = valor as Record<string, unknown>;
    const ordenado: Record<string, unknown> = {};
    for (const clave of Object.keys(plano).sort()) ordenado[clave] = canonico(plano[clave]);
    return ordenado;
  }
  return valor;
}

/**
 * Huella del pedido: sha256 del JSON con las claves ordenadas. El mismo pedido
 * da la misma huella aunque cambie el orden de las claves.
 */
export const huellaDe = (valor: unknown): string =>
  createHash("sha256").update(JSON.stringify(canonico(valor))).digest("hex");

/**
 * ¿Es un E11000 sobre un índice que incluye `campo`?
 *
 * insertMany tira MongoBulkWriteError y no siempre trae keyPattern, por eso se
 * mira también el nombre del índice (ej. "marca_1_claveIdempotencia_1_factura_1").
 * La usan la idempotencia, el numerado de facturas y la apertura de facturas.
 */
export function esClaveDuplicadaEn(error: unknown, campo: string): boolean {
  if (error === null || typeof error !== "object") return false;

  const e = error as { code?: unknown; keyPattern?: Record<string, unknown>; message?: unknown };
  if (e.code !== 11000) return false;

  if (e.keyPattern && Object.prototype.hasOwnProperty.call(e.keyPattern, campo)) return true;

  const indice = /index: (\S+)/.exec(String(e.message))?.[1];
  return indice ? indice.split("_").includes(campo) : false;
}
