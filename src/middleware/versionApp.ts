import type { NextFunction, Request, Response } from "express";
import { AppError } from "../utils/AppError.js";
import { compararVersiones, configVersion } from "../utils/version.js";

// Rutas que nunca se bloquean: la raíz y /health (el hosting), /app (de ahí la
// app lee la versión y reporta errores), /legal y /publico (las abre gente
// sin la app) y /cuenta (páginas HTML que se abren desde un mail).
const RUTAS_LIBRES = /^\/(app|legal|publico|cuenta)(\/|$)/;

/**
 * Corta con 426 APP_DESACTUALIZADA a las versiones de la app más viejas que
 * APP_VERSION_MINIMA (K8).
 *
 * El back se actualiza al instante y la app de Play cuando cada usuario
 * quiere: sin esto, un cambio incompatible del back rompe a los que no
 * actualizaron con errores que no entienden. Con esto ven "actualizá" y el
 * link a la tienda.
 *
 * Sin header X-App-Version (curl, versiones viejas, las páginas HTML) o con
 * una versión que no se entiende, NO bloquea: preferimos dejar pasar que
 * dejar afuera a alguien por un header raro.
 */
export function exigirVersionMinima(req: Request, _res: Response, next: NextFunction): void {
  if (req.path === "/" || req.path === "/health" || RUTAS_LIBRES.test(req.path)) {
    next();
    return;
  }

  const version = req.get("X-App-Version")?.trim();
  if (!version) {
    next();
    return;
  }

  const { minima, urlTienda } = configVersion();
  if (compararVersiones(version, minima) === -1) {
    next(
      new AppError(
        "Hay una versión nueva de la app. Actualizala para seguir.",
        426,
        { minima, urlTienda },
        "APP_DESACTUALIZADA"
      )
    );
    return;
  }

  next();
}
