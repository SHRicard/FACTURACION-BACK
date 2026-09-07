import type { NextFunction, Request, Response } from "express";
import { logger, pintar, type Color } from "../utils/logger.js";
import type { ErrorEnLocals } from "../types/index.js";

// Loguea cada request cuando termina, con método, ruta, status y duración.
//
// Nivel según el status: 2xx/3xx en debug, 4xx en warn, 5xx en error.
// Así en desarrollo (LOG_LEVEL=debug) ves todo, y en producción
// (LOG_LEVEL=info) solo quedan las que fallaron.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;

    const color: Color =
      res.statusCode >= 500 ? "rojo" : res.statusCode >= 400 ? "amarillo" : "verde";

    const partes: string[] = [
      pintar(req.method.padEnd(6), "negrita"),
      req.originalUrl,
      pintar(res.statusCode, color),
      pintar(`${ms.toFixed(1)}ms`, "gris"),
    ];

    // Si sabemos quién hizo la request, lo agregamos.
    if (req.usuario) partes.push(pintar(`(${req.usuario.email})`, "gris"));

    // El errorHandler deja acá el motivo, para que quede todo en una sola línea.
    const error = res.locals["error"] as ErrorEnLocals | undefined;
    if (error) {
      partes.push(pintar("—", "gris"), error.mensaje);
      if (error.detalles) partes.push(JSON.stringify(error.detalles));
    }

    const linea = partes.join(" ");

    if (res.statusCode >= 500) logger.error(linea);
    else if (res.statusCode >= 400) logger.warn(linea);
    else logger.debug(linea);
  });

  next();
}

export default requestLogger;
