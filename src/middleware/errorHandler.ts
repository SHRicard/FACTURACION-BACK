import type { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { AppError } from "../utils/AppError.js";
import { logger, pintar, sanitizar, esProduccion } from "../utils/logger.js";
import type { ErrorEnLocals } from "../types/index.js";

// jsonwebtoken es CommonJS: `import { JsonWebTokenError } from "jsonwebtoken"`
// compila pero revienta en runtime ("Named export not found"). Las sacamos del
// default export, que es lo que Node sí sabe resolver.
const { JsonWebTokenError, TokenExpiredError } = jwt;

interface ErrorTraducido {
  statusCode: number;
  mensaje: string;
  detalles?: unknown;
}

// El driver de Mongo tira este error cuando se viola un índice único. No lo
// exporta como clase, así que lo reconocemos por la forma.
interface ErrorClaveDuplicada {
  code: 11000;
  keyPattern?: Record<string, unknown>;
  keyValue?: Record<string, unknown>;
}

const esClaveDuplicada = (error: unknown): error is ErrorClaveDuplicada =>
  typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;

const esJsonRoto = (error: unknown): boolean => error instanceof SyntaxError && "body" in error;

// Traduce cualquier error a { statusCode, mensaje, detalles }.
// Acá centralizamos los errores típicos de mongoose/jwt para no repetir
// el mismo try/catch en cada ruta.
function traducirError(error: unknown): ErrorTraducido {
  if (error instanceof AppError) {
    return { statusCode: error.statusCode, mensaje: error.message, detalles: error.detalles };
  }

  // Validación de un schema de mongoose → qué campo falló y por qué.
  if (error instanceof mongoose.Error.ValidationError) {
    const detalles = Object.fromEntries(
      Object.values(error.errors).map((e) => [e.path, e.message])
    );
    return { statusCode: 400, mensaje: "Datos inválidos", detalles };
  }

  // ObjectId mal formado (ej: /clientes/123).
  if (error instanceof mongoose.Error.CastError) {
    return { statusCode: 400, mensaje: `El valor de "${error.path}" no es válido` };
  }

  // Índice único violado (ej: email de usuario repetido).
  if (esClaveDuplicada(error)) {
    const campos = Object.keys(error.keyPattern ?? error.keyValue ?? {});

    // En un índice compuesto el conflicto es por la COMBINACIÓN de campos.
    // Nombrar solo el primero manda a buscar el problema al lugar equivocado:
    // "ya existe un registro con ese administrador" cuando en realidad se
    // repite el DNI dentro de ese negocio.
    const utiles = campos.filter((c) => c !== "marca");
    const nombrar = (utiles.length ? utiles : campos).join(" + ") || "valor";

    return { statusCode: 409, mensaje: `Ya existe un registro con ese ${nombrar}` };
  }

  if (error instanceof TokenExpiredError) {
    return { statusCode: 401, mensaje: "Token expirado" };
  }
  if (error instanceof JsonWebTokenError) {
    return { statusCode: 401, mensaje: "Token inválido" };
  }

  // JSON mal formado en el body (lo tira express.json()).
  if (esJsonRoto(error)) {
    return { statusCode: 400, mensaje: "El body no es un JSON válido" };
  }

  // Cualquier otra cosa es un bug nuestro.
  return { statusCode: 500, mensaje: "Error interno del servidor" };
}

// Middleware final: loguea el error en consola y responde JSON.
// Tiene que ir DESPUÉS de todas las rutas y llevar los 4 argumentos,
// si no Express no lo reconoce como manejador de errores.
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Si ya se empezó a enviar la respuesta, delegamos en Express.
  if (res.headersSent) {
    next(error);
    return;
  }

  const { statusCode, mensaje, detalles } = traducirError(error);

  // requestLogger lo lee al terminar la request y lo agrega a su línea, así no
  // imprimimos dos veces el mismo método + ruta + status.
  const enLocals: ErrorEnLocals = detalles === undefined ? { mensaje } : { mensaje, detalles };
  res.locals["error"] = enLocals;

  if (statusCode >= 500) {
    // Bug nuestro: queremos el stack completo y todo el contexto de la request.
    logger.error(pintar(`${req.method} ${req.originalUrl} → ${statusCode}`, "negrita"));
    logger.error(error);
    logger.error("  request:", {
      params: req.params,
      query: req.query,
      body: sanitizar(req.body),
      usuario: req.usuario ? { id: String(req.usuario._id), email: req.usuario.email } : null,
    });
  } else if (statusCode === 400) {
    // Error esperado, pero el body ayuda a entender por qué no validó.
    logger.debug("  body:", sanitizar(req.body));
  }

  // El stack solo viaja al cliente si es un bug (5xx) y no estamos en
  // producción. Los 4xx ya se explican con el mensaje y no necesitan ruido.
  const stack =
    !esProduccion() && statusCode >= 500 && error instanceof Error && error.stack
      ? error.stack.split("\n")
      : undefined;

  res.status(statusCode).json({
    error: mensaje,
    ...(detalles !== undefined && { detalles }),
    ...(stack && { stack }),
  });
}

// Cae acá cualquier ruta que no matcheó. Va antes del errorHandler.
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

export default errorHandler;
