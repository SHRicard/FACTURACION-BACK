import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import { AppError, noAutorizado, prohibido } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";
import type { RequestAutenticado } from "../types/index.js";
import type { Rol } from "../config/roles.js";

// Lo que guardamos dentro del JWT.
export interface PayloadToken extends jwt.JwtPayload {
  id: string;
  rol: string;
}

/**
 * Corta a una cuenta suspendida por el super_admin. 403 y no 401: el front
 * cierra la sesión igual, pero con `codigo` puede mostrar por qué en vez de
 * mandar al login como si el token hubiera vencido.
 */
export function exigirNoSuspendida(usuario: Pick<UsuarioDocument, "suspendida" | "motivoSuspension">): void {
  if (!usuario.suspendida) return;
  throw new AppError(
    "Tu cuenta está suspendida. Escribinos si creés que es un error.",
    403,
    usuario.motivoSuspension ? { motivo: usuario.motivoSuspension } : undefined,
    "CUENTA_SUSPENDIDA"
  );
}

// Cada cuánto se guarda el último acceso: no vale una escritura por request.
const MS_ENTRE_ACCESOS = 5 * 60 * 1000;

/**
 * Deja anotado el último acceso y la versión de la app, para el monitoreo del
 * super_admin. Sin await: si falla, se loguea y la request sigue.
 */
function registrarAcceso(usuario: UsuarioDocument, req: Request): void {
  const version = req.get("X-App-Version")?.trim().slice(0, 20) || undefined;
  const ahora = Date.now();
  const reciente =
    usuario.ultimoAcceso !== undefined &&
    ahora - usuario.ultimoAcceso.getTime() < MS_ENTRE_ACCESOS;
  if (reciente && (!version || version === usuario.ultimaVersionApp)) return;

  const $set: { ultimoAcceso: Date; ultimaVersionApp?: string } = { ultimoAcceso: new Date(ahora) };
  if (version) $set.ultimaVersionApp = version;
  Usuario.updateOne({ _id: usuario._id }, { $set }).catch((error: unknown) => logger.error(error));
}

// Verifica el token JWT y carga req.usuario
export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      throw noAutorizado("Token no proporcionado");
    }

    const token = authHeader.slice("Bearer ".length);

    const secreto = process.env["JWT_SECRET"];
    if (!secreto) throw new Error("Falta la variable JWT_SECRET en el .env");

    const payload = jwt.verify(token, secreto) as PayloadToken;

    // passwordCambiadoEn tiene select:false, hay que pedirlo explícito.
    const usuario = await Usuario.findById(payload.id).select("+passwordCambiadoEn");
    if (!usuario) throw noAutorizado("Usuario no encontrado");

    // Si cambió la contraseña después de que se emitió este token, la sesión
    // vieja ya no vale (sirve para cerrar sesiones tras un reseteo).
    if (payload.iat !== undefined && usuario.passwordCambioDespuesDelToken(payload.iat)) {
      throw noAutorizado("Tu contraseña cambió, iniciá sesión de nuevo");
    }
    exigirNoSuspendida(usuario);

    registrarAcceso(usuario, req);
    req.usuario = usuario;
    next();
  } catch (error) {
    // Solo los errores de JWT significan "token inválido". Cualquier otra cosa
    // (la base caída, un bug acá) va al errorHandler para que se loguee como
    // el error real que es, en vez de disfrazarse de 401.
    next(error);
  }
}

/**
 * Como requireAuth, pero la sesión es opcional: si el token sirve deja
 * req.usuario, y si no sigue como anónimo. Nunca responde 401.
 *
 * Es para POST /app/errores (K12): el reporte de un error de la app tiene que
 * llegar igual con la sesión vencida o rota, que es justo cuando más falla.
 * Un 401 ahí además haría que el front cierre la sesión por un reporte.
 */
export async function autenticacionOpcional(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const secreto = process.env["JWT_SECRET"];

    if (authHeader?.startsWith("Bearer ") && secreto) {
      const token = authHeader.slice("Bearer ".length);
      const payload = jwt.verify(token, secreto) as PayloadToken;

      const usuario = await Usuario.findById(payload.id).select("+passwordCambiadoEn");
      const sigueValiendo =
        usuario !== null &&
        !usuario.suspendida &&
        (payload.iat === undefined || !usuario.passwordCambioDespuesDelToken(payload.iat));

      if (usuario && sigueValiendo) req.usuario = usuario;
    }
  } catch {
    // Token roto o vencido, id inválido, base caída: se sigue como anónimo.
  }
  next();
}

/**
 * Restringe una ruta a ciertos roles. Va siempre después de requireAuth.
 *
 *   router.use(requireAuth, requireRol("super_admin"));
 *
 * Cuando exista el rol "cliente" no hace falta un middleware nuevo:
 * requireRol("administrador", "cliente") y listo.
 */
export function requireRol(...permitidos: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { usuario } = req as RequestAutenticado;

    if (!permitidos.includes(usuario.rol)) {
      next(
        prohibido(
          permitidos.length === 1 && permitidos[0] === "super_admin"
            ? "Solo el super_admin puede hacer esto"
            : "No tenés permiso para hacer esto"
        )
      );
      return;
    }
    next();
  };
}

/** Atajo para el caso más común. Equivale a requireRol("super_admin"). */
export const requireSuperAdmin = requireRol("super_admin");
