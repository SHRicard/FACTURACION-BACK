import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

// Rate limit simple, en memoria, para frenar fuerza bruta en /auth.
//
// Por defecto cuenta por IP (req.ip). Detrás de un proxy (cualquier hosting
// con HTTPS) eso solo es la IP del cliente si está configurado `trust proxy`
// con la cantidad exacta de saltos (server.ts, variable TRUST_PROXY): sin eso
// req.ip es la del proxy y toda la app comparte un único contador.
//
// Con la opción `clave` se cuenta por otra cosa (el email del login, el
// usuario, la marca). Ver porEmailDelBody, porUsuario y porMarca.
//
// Limitación conocida: el contador vive en el proceso. Con varias instancias
// del server cada una lleva el suyo. Para producción con más de una instancia
// hay que moverlo a Redis, pero para un solo proceso cumple.

interface Contador {
  intentos: number;
  resetEn: number;
}

const contadores = new Map<string, Contador>();

// Limpieza periódica para que el Map no crezca para siempre.
// unref() para que este timer no impida que el proceso termine.
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, dato] of contadores) {
    if (dato.resetEn <= ahora) contadores.delete(clave);
  }
}, 60_000).unref();

export interface OpcionesRateLimit {
  /** Intentos permitidos por ventana. */
  maximo?: number;
  /** Duración de la ventana, en milisegundos. */
  ventanaMs?: number;
  /** Para distinguir contadores entre rutas. */
  nombre?: string;
  /**
   * Qué se cuenta. Por defecto la IP (req.ip, que con trust proxy es la del
   * cliente). Si devuelve undefined se cuenta por IP.
   */
  clave?: (req: Request) => string | undefined;
}

/** La clave del contador: el nombre del límite + lo que se cuenta. */
function claveDe(nombre: string, req: Request, clave?: OpcionesRateLimit["clave"]): string {
  return `${nombre}:${clave?.(req) ?? req.ip ?? "sin-ip"}`;
}

/**
 * Cuenta por el email del body (login, recuperar contraseña). Normalizado
 * igual que en la base, así "Ana@x.com " y "ana@x.com" son el mismo contador.
 * Sin email en el body cae a la IP.
 */
export function porEmailDelBody(req: Request): string | undefined {
  const email: unknown = req.body?.email;
  if (typeof email !== "string") return undefined;
  const normalizado = email.trim().toLowerCase();
  return normalizado ? `email:${normalizado}` : undefined;
}

/** Cuenta por usuario logueado. Va después de requireAuth. */
export function porUsuario(req: Request): string | undefined {
  return req.usuario ? `usuario:${String(req.usuario._id)}` : undefined;
}

/** Cuenta por marca (el negocio). Va después de requireMarca. */
export function porMarca(req: Request): string | undefined {
  return req.marca ? `marca:${String(req.marca._id)}` : undefined;
}

export function rateLimit({
  maximo = 10,
  ventanaMs = 15 * 60 * 1000,
  nombre = "global",
  clave: queContar,
}: OpcionesRateLimit = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Deshabilitado en tests, si no habría que esperar entre casos.
    if (process.env["NODE_ENV"] === "test") return next();

    const clave = claveDe(nombre, req, queContar);
    const ahora = Date.now();
    const dato = contadores.get(clave);

    if (!dato || dato.resetEn <= ahora) {
      contadores.set(clave, { intentos: 1, resetEn: ahora + ventanaMs });
      return next();
    }

    dato.intentos += 1;

    if (dato.intentos > maximo) {
      const segundos = Math.ceil((dato.resetEn - ahora) / 1000);
      res.set("Retry-After", String(segundos));
      // Se loguea la IP y no la clave: la clave puede ser un email.
      logger.warn(`Rate limit "${nombre}" alcanzado por ${req.ip} (${dato.intentos} intentos)`);
      return next(
        new AppError(
          `Demasiados intentos. Probá de nuevo en ${Math.ceil(segundos / 60)} minutos.`,
          429
        )
      );
    }

    next();
  };
}

// Deja de contar los intentos de una request que salió bien, así un login
// correcto no consume el cupo de quien se equivocó antes.
//
// Borra solo la clave de ESTA request: con `clave` = porEmailDelBody, un login
// correcto limpia el contador de ese email y no el de la IP ni el de otros
// emails. Si no, cualquiera con una cuenta propia le reiniciaría el cupo a un
// atacante con solo entrar.
export function limpiarRateLimit(
  nombre: string,
  req: Request,
  clave?: (req: Request) => string | undefined
): void {
  contadores.delete(claveDe(nombre, req, clave));
}

export default rateLimit;
