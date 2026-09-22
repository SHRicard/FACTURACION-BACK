import { createHash } from "node:crypto";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

/**
 * Cloudinary, para el logo de cada marca. Uno por marca, y punto: cambiarlo
 * pisa el anterior (ver publicIdLogo).
 *
 * Sin SDK a propósito: lo único que hace falta es firmar parámetros (SHA-1),
 * armar URLs de entrega y borrar un logo viejo. La subida la hace la app
 * directo contra Cloudinary con la firma que le da el backend, así el archivo
 * nunca pasa por nuestro server y el secreto nunca sale de acá.
 */

export interface ConfigCloudinary {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

/** Sale de CLOUDINARY_URL o de las tres variables sueltas. Null si falta algo. */
export function configCloudinary(): ConfigCloudinary | null {
  // Formato de la consola de Cloudinary: cloudinary://<api_key>:<api_secret>@<cloud_name>
  const url = process.env["CLOUDINARY_URL"]?.trim();
  const partes = url ? /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/.exec(url) : null;
  if (partes?.[1] && partes[2] && partes[3]) {
    return { apiKey: partes[1], apiSecret: partes[2], cloudName: partes[3] };
  }

  const cloudName = process.env["CLOUDINARY_CLOUD_NAME"]?.trim();
  const apiKey = process.env["CLOUDINARY_API_KEY"]?.trim();
  const apiSecret = process.env["CLOUDINARY_API_SECRET"]?.trim();
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

function exigirConfig(): ConfigCloudinary {
  const config = configCloudinary();
  if (!config) throw new AppError("La subida de logos no está configurada en el servidor", 503);
  return config;
}

/** La firma de Cloudinary: parámetros ordenados "a=1&b=2", más el secreto, en SHA-1. */
export function firmar(params: Record<string, string | number>, apiSecret: string): string {
  const cadena = Object.keys(params)
    .sort()
    .map((clave) => `${clave}=${params[clave]}`)
    .join("&");
  return createHash("sha1").update(cadena + apiSecret).digest("hex");
}

/** Sin SVG: puede traer scripts, y el PDF igual necesita una imagen de mapa de bits. */
export const FORMATOS_LOGO = ["png", "jpg", "jpeg", "webp"] as const;

/**
 * UN logo por marca, siempre en el mismo lugar: marcas/<id de la marca>/logo.
 *
 * El nombre es fijo a propósito. Cambiar el logo pisa el archivo anterior en
 * vez de sumar otro, así en Cloudinary nunca hay más de un logo por marca,
 * aunque se suba diez veces, lo suban dos dueños distintos o la app nunca
 * confirme una subida.
 */
export const publicIdLogo = (marcaId: string): string => `marcas/${marcaId}/logo`;

/**
 * Al guardarlo, Cloudinary lo achica a 1000×1000 como máximo: un logo no
 * necesita más, y así cada uno ocupa poco aunque suban una foto de 12 MP.
 */
const TRANSFORMACION_AL_SUBIR = "c_limit,w_1000,h_1000";

/**
 * Lo que la app necesita para subir el logo directo a Cloudinary: la URL y
 * los campos que van en el FormData, junto al archivo (`file`).
 *
 * La firma fija TODO lo que importa: el nombre del archivo (el de esta
 * marca), que pise al anterior, los formatos y el tamaño máximo. Con ella
 * solo se puede reemplazar el logo de esta marca. Vale una hora.
 */
export function firmaSubidaLogo(marcaId: string) {
  const config = exigirConfig();
  const params = {
    allowed_formats: FORMATOS_LOGO.join(","),
    // Borra de la caché de Cloudinary la versión anterior, si había.
    invalidate: "true",
    overwrite: "true",
    public_id: publicIdLogo(marcaId),
    timestamp: Math.floor(Date.now() / 1000),
    transformation: TRANSFORMACION_AL_SUBIR,
  };

  return {
    urlSubida: `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    campos: { ...params, api_key: config.apiKey, signature: firmar(params, config.apiSecret) },
  };
}

/** URL de entrega del logo. Con versión, así un logo nuevo no queda tapado por la caché. */
export function urlLogo(publicId: string, version?: number): string {
  const { cloudName } = exigirConfig();
  return `https://res.cloudinary.com/${cloudName}/image/upload/${version ? `v${version}/` : ""}${publicId}`;
}

/** Que la imagen exista de verdad antes de guardarla en el perfil. */
export async function existeImagen(url: string): Promise<boolean> {
  try {
    const respuesta = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
    return respuesta.ok;
  } catch {
    return false;
  }
}

/**
 * Borra una imagen de Cloudinary (y de su caché). No tira: si falla, el
 * archivo queda, pero como el logo tiene nombre fijo, la próxima subida lo
 * pisa igual. Nunca se acumulan.
 */
export async function eliminarImagen(publicId: string): Promise<void> {
  const config = configCloudinary();
  if (!config) return;

  const timestamp = Math.floor(Date.now() / 1000);
  const cuerpo = new URLSearchParams({
    public_id: publicId,
    invalidate: "true",
    timestamp: String(timestamp),
    api_key: config.apiKey,
    signature: firmar({ invalidate: "true", public_id: publicId, timestamp }, config.apiSecret),
  });

  try {
    const respuesta = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`,
      { method: "POST", body: cuerpo, signal: AbortSignal.timeout(8000) }
    );
    if (!respuesta.ok) logger.warn(`Cloudinary no borró ${publicId} (${respuesta.status})`);
  } catch (error) {
    logger.warn(`No se pudo borrar ${publicId} de Cloudinary:`, error);
  }
}

// ─────────────────────────────────────────────────────────────
// El logo para el PDF y el mail.
//
// pdfmake solo entiende PNG y JPEG, y el logo puede haberse subido en webp:
// se le pide a Cloudinary una versión PNG acotada, y se guarda en memoria.
// Como la URL lleva la versión, un logo nuevo tiene otra URL y no hay que
// invalidar nada.

const TRANSFORMACION_PDF = "c_limit,w_440,h_160,f_png";
const MAXIMO_EN_CACHE = 100;
const cacheLogos = new Map<string, Buffer>();

export interface LogoMarca {
  /** El PNG, para adjuntarlo al mail. */
  buffer: Buffer;
  /** El mismo PNG como data URL, para el PDF. */
  dataUrl: string;
}

const comoLogo = (buffer: Buffer): LogoMarca => ({
  buffer,
  dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
});

/**
 * El logo listo para usar, o null si no hay o no se pudo traer. Nunca tira:
 * sin logo, el PDF sale igual con el nombre de la marca.
 */
export async function traerLogo(logoUrl?: string | null): Promise<LogoMarca | null> {
  if (!logoUrl) return null;

  const url = logoUrl.replace("/image/upload/", `/image/upload/${TRANSFORMACION_PDF}/`);
  const enCache = cacheLogos.get(url);
  if (enCache) return comoLogo(enCache);

  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!respuesta.ok) throw new Error(`status ${respuesta.status}`);
    if (!respuesta.headers.get("content-type")?.startsWith("image/png")) {
      throw new Error(`no es PNG (${respuesta.headers.get("content-type")})`);
    }

    const buffer = Buffer.from(await respuesta.arrayBuffer());

    // Se va el más viejo: un Map recorre en orden de inserción.
    if (cacheLogos.size >= MAXIMO_EN_CACHE) {
      const primero = cacheLogos.keys().next().value;
      if (primero !== undefined) cacheLogos.delete(primero);
    }
    cacheLogos.set(url, buffer);

    return comoLogo(buffer);
  } catch (error) {
    logger.warn(`No se pudo traer el logo (${url}), va sin logo:`, error);
    return null;
  }
}
