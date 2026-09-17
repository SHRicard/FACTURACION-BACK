import { createHmac } from "node:crypto";
import jwt, { type JwtPayload } from "jsonwebtoken";
import type { FacturaDocument } from "../models/Factura.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

/**
 * Links públicos a la factura: el cliente la abre desde WhatsApp sin loguearse.
 *
 * El link lleva un JWT firmado con una clave PROPIA, distinta de la de las
 * sesiones: un token de link nunca pasa por requireAuth, y un token de sesión
 * nunca abre una factura. Adentro va el id de la factura y su `versionEnlace`;
 * para dar de baja todos los links mandados alcanza con subir esa versión.
 *
 * ¿Por qué no un token aleatorio guardado en la factura? Porque solo podría
 * haber uno vivo: generar un link nuevo mataría el que se mandó ayer.
 */

const AUDIENCIA = "factura-publica";

export const DIAS_VALIDEZ_POR_DEFECTO = 7;

export function claveEnlaces(): string | Buffer {
  const propia = process.env["ENLACES_SECRET"]?.trim();
  if (propia) return propia;

  const secreto = process.env["JWT_SECRET"];
  if (!secreto) throw new Error("Falta la variable JWT_SECRET en el .env");

  // Derivada de JWT_SECRET: una sola clave para configurar, pero distinta.
  return createHmac("sha256", secreto).update("morgana:enlace-factura:v1").digest();
}

export function firmarEnlace(factura: FacturaDocument, dias: number) {
  const token = jwt.sign({ v: factura.versionEnlace ?? 0 }, claveEnlaces(), {
    subject: String(factura._id),
    audience: AUDIENCIA,
    expiresIn: `${dias}d`,
    algorithm: "HS256",
  });

  const { exp } = jwt.decode(token) as JwtPayload;
  return { token, venceEl: new Date((exp ?? 0) * 1000) };
}

/** El link, si es válido. Nunca tira: cualquier problema es "no hay link". */
export function verificarEnlace(token: string): { facturaId: string; version: number } | null {
  try {
    const payload = jwt.verify(token, claveEnlaces(), {
      audience: AUDIENCIA,
      algorithms: ["HS256"],
    });
    if (typeof payload === "string" || !payload.sub) return null;
    return { facturaId: payload.sub, version: Number(payload["v"] ?? 0) };
  } catch {
    return null;
  }
}

let avisoSinUrl = false;

/**
 * URL pública de la API: la que abre el teléfono del cliente, que no está en
 * nuestra red. Sale de API_PUBLIC_URL.
 */
export function urlApi(ruta: string): string {
  const base = process.env["API_PUBLIC_URL"]?.trim().replace(/\/+$/, "");
  if (base) return `${base}${ruta}`;

  if (process.env["NODE_ENV"] === "production") {
    throw new AppError("Falta configurar API_PUBLIC_URL en el servidor", 503);
  }

  if (!avisoSinUrl) {
    logger.warn("Sin API_PUBLIC_URL: los links públicos apuntan a localhost y solo abren en esta máquina");
    avisoSinUrl = true;
  }
  return `http://localhost:${process.env["PORT"] ?? 4000}${ruta}`;
}
