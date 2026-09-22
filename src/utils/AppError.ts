// Error con código HTTP, para cortar un handler desde cualquier profundidad:
//
//   throw new AppError("Cliente no encontrado", 404);
//   throw noEncontrado("Producto");
//   throw errorDeCampo("dni", "El DNI tiene que tener 7 u 8 números");
//
// El middleware de errores lo traduce a la respuesta JSON y lo loguea.

/**
 * Lo que viaja en `detalles` de la respuesta de error. Una sola regla para
 * todo el back, así el front no tiene que adivinar qué es cada cosa:
 *
 * - `detalles.campos` = mensajes por campo. La clave es la ruta del campo en
 *   el formulario de React Hook Form (ej. "dni" o "items.0.precioUnitario") y
 *   el valor es el texto que se muestra debajo de ese input.
 * - El resto de `detalles` son datos para la pantalla (números, arrays): la
 *   deuda, los usos de una especie, los métodos válidos.
 * - `codigo` (aparte, en el AppError) es SCREAMING_SNAKE y estable. Se manda
 *   solo cuando el front tiene que actuar distinto, no en cada error.
 */
export type DetallesError = { campos?: Record<string, string> } & Record<string, unknown>;

export class AppError extends Error {
  readonly statusCode: number;
  readonly detalles: DetallesError | undefined;
  readonly codigo: string | undefined;
  // Marca los errores "esperados" (validaciones, permisos, no encontrado)
  // para distinguirlos de un bug real y no llenar la consola de stacks.
  readonly esOperacional = true;

  constructor(mensaje: string, statusCode = 500, detalles?: DetallesError, codigo?: string) {
    super(mensaje);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.detalles = detalles;
    this.codigo = codigo;
    Error.captureStackTrace?.(this, AppError);
  }
}

// El género va aparte porque el mensaje lo lee el usuario: "Factura no
// encontrado" se nota. Por defecto masculino, que es el caso más común.
export const noEncontrado = (que = "Recurso", genero: "o" | "a" = "o"): AppError =>
  new AppError(`${que} no encontrad${genero}`, 404);

export const datosInvalidos = (mensaje: string, detalles?: DetallesError): AppError =>
  new AppError(mensaje, 400, detalles);

/**
 * Error de UN campo del formulario: el mensaje va como `error` y también en
 * `detalles.campos[campo]`, para que el front lo ponga debajo de ese input.
 * `extra` suma datos para la pantalla; va primero para que no pise `campos`.
 */
export const errorDeCampo = (
  campo: string,
  mensaje: string,
  statusCode = 400,
  extra?: Record<string, unknown>
): AppError => new AppError(mensaje, statusCode, { ...extra, campos: { [campo]: mensaje } });

// Solo para sesión inválida (token ausente, vencido o de un usuario borrado).
// Si la persona tipea una credencial en un formulario con la sesión abierta y
// está mal, es 400 con codigo CREDENCIALES_INVALIDAS: el front cierra la
// sesión ante cualquier 401 de una ruta no pública.
export const noAutorizado = (mensaje = "No autorizado"): AppError => new AppError(mensaje, 401);

export const prohibido = (mensaje = "No tenés permiso para hacer esto"): AppError =>
  new AppError(mensaje, 403);
