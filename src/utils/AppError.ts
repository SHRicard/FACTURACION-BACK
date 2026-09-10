// Error con código HTTP, para cortar un handler desde cualquier profundidad:
//
//   throw new AppError("Cliente no encontrado", 404);
//   throw noEncontrado("Producto");
//
// El middleware de errores lo traduce a la respuesta JSON y lo loguea.
export class AppError extends Error {
  readonly statusCode: number;
  readonly detalles: unknown;
  // Marca los errores "esperados" (validaciones, permisos, no encontrado)
  // para distinguirlos de un bug real y no llenar la consola de stacks.
  readonly esOperacional = true;

  constructor(mensaje: string, statusCode = 500, detalles?: unknown) {
    super(mensaje);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.detalles = detalles;
    Error.captureStackTrace?.(this, AppError);
  }
}

// El género va aparte porque el mensaje lo lee el usuario: "Factura no
// encontrado" se nota. Por defecto masculino, que es el caso más común.
export const noEncontrado = (que = "Recurso", genero: "o" | "a" = "o"): AppError =>
  new AppError(`${que} no encontrad${genero}`, 404);

export const datosInvalidos = (mensaje: string, detalles?: unknown): AppError =>
  new AppError(mensaje, 400, detalles);

export const noAutorizado = (mensaje = "No autorizado"): AppError => new AppError(mensaje, 401);

export const prohibido = (mensaje = "No tenés permiso para hacer esto"): AppError =>
  new AppError(mensaje, 403);
