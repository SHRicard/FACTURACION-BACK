import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

// Rate limit simple, en memoria, para frenar fuerza bruta en /auth.
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
}

export function rateLimit({
  maximo = 10,
  ventanaMs = 15 * 60 * 1000,
  nombre = "global",
}: OpcionesRateLimit = {}): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Deshabilitado en tests, si no habría que esperar entre casos.
    if (process.env["NODE_ENV"] === "test") return next();

    const clave = `${nombre}:${req.ip}`;
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
export function limpiarRateLimit(nombre: string, req: Request): void {
  contadores.delete(`${nombre}:${req.ip}`);
}

export default rateLimit;
