import type { NextFunction, Request, Response } from "express";
import { esProduccion, logger, pintar, type Color } from "../utils/logger.js";
import type { ErrorEnLocals } from "../types/index.js";

// Loguea cada request cuando termina, con método, ruta, status y duración.
//
// Nivel según el status: 5xx en error, 4xx en warn, las lentas (1 s o más)
// en warn y el resto en debug. Así en desarrollo (LOG_LEVEL=debug) ves todo,
// y en producción (LOG_LEVEL=info) quedan las que fallaron y las lentas.

/** A partir de cuántos ms una request que salió bien se loguea igual. */
const UMBRAL_LENTA_MS = 1000;

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const inicio = process.hrtime.bigint();

  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;

    const color: Color =
      res.statusCode >= 500 ? "rojo" : res.statusCode >= 400 ? "amarillo" : "verde";

    // El token de un link público y el de reseteo de contraseña son llaves:
    // al log va solo la punta.
    const url = req.originalUrl.replace(
      /(\/publico\/facturas\/|\/auth\/recuperar-password\/)([^/?]+)/,
      (_todo, prefijo: string, token: string) => `${prefijo}…${token.slice(-6)}`
    );

    const partes: string[] = [
      pintar(req.method.padEnd(6), "negrita"),
      url,
      pintar(res.statusCode, color),
      pintar(`${ms.toFixed(1)}ms`, "gris"),
    ];

    // Si sabemos quién hizo la request, lo agregamos. En producción va el id
    // y no el email: los logs del hosting los lee más gente y quedan guardados.
    if (req.usuario) {
      const quien = esProduccion() ? `usuario ${String(req.usuario._id)}` : req.usuario.email;
      partes.push(pintar(`(${quien})`, "gris"));
    }

    // El errorHandler deja acá el motivo, para que quede todo en una sola línea.
    const error = res.locals["error"] as ErrorEnLocals | undefined;
    if (error) {
      partes.push(pintar("—", "gris"), error.mensaje);
      if (error.codigo) partes.push(`[${error.codigo}]`);
      if (error.detalles) partes.push(JSON.stringify(error.detalles));
    }

    const lenta = ms >= UMBRAL_LENTA_MS;
    if (lenta) partes.push(pintar("(lenta)", "amarillo"));

    const linea = partes.join(" ");

    if (res.statusCode >= 500) logger.error(linea);
    else if (res.statusCode >= 400 || lenta) logger.warn(linea);
    else logger.debug(linea);
  });

  next();
}

export default requestLogger;
