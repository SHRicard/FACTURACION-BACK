import type { NextFunction, Request, Response } from "express";
import Marca from "../models/Marca.js";
import type { UsuarioDocument } from "../models/Usuario.js";
import { AppError, prohibido } from "../utils/AppError.js";
import { requireAuth } from "./auth.js";
import type { RequestAutenticado, RequestConMarca } from "../types/index.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../legal/documentos.js";

/**
 * Qué le falta al usuario para empezar a usar la app, en orden:
 *   "perfil" → cargar su DNI
 *   "marca"  → crear su marca, o que un dueño lo sume con su DNI
 *   null     → nada, ya puede operar
 *
 * El front lo usa para decidir qué pantalla de bienvenida mostrar.
 */
export type Pendiente = "terminos" | "perfil" | "marca" | null;

export function pendienteDe(
  usuario: Pick<
    UsuarioDocument,
    | "rol"
    | "dni"
    | "marca"
    | "aceptoTerminosYCondiciones"
    | "terminosYCondicionesVersion"
  >,
): Pendiente {
  if (usuario.rol === "super_admin") return null;
  if (
    !usuario.aceptoTerminosYCondiciones ||
    usuario.terminosYCondicionesVersion !== VERSION_DOCUMENTOS_LEGALES
  ) {
    return "terminos";
  }
  if (!usuario.dni) return "perfil";
  if (!usuario.marca) return "marca";
  return null;
}

/**
 * Todo lo del negocio pasa por acá: carga la marca del usuario en req.marca
 * y corta si todavía no tiene. Va siempre después de requireAuth.
 *
 * Los 403 traen `detalles.pendiente`, así el front sabe a qué pantalla
 * mandar sin tener que interpretar el mensaje.
 */
export async function requireMarca(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { usuario } = req as RequestAutenticado;

    if (usuario.rol === "super_admin") {
      throw prohibido(
        "El super_admin no opera marcas: entrá con una cuenta de administrador",
      );
    }

    const pendiente = pendienteDe(usuario);
    if (pendiente === "terminos") {
      throw new AppError(
        "Aceptá los términos y condiciones antes de empezar",
        403,
        { pendiente },
      );
    }
    if (pendiente === "perfil") {
      throw new AppError(
        "Completá tu perfil con tu DNI antes de empezar",
        403,
        { pendiente },
      );
    }

    // Un usuario que apunta a una marca borrada está, en la práctica, sin marca.
    const marca = pendiente ? null : await Marca.findById(usuario.marca);
    if (!marca) {
      throw new AppError(
        "Creá tu marca o pedile a un dueño que te sume con tu DNI",
        403,
        { pendiente: "marca" },
      );
    }

    (req as RequestConMarca).marca = marca;
    next();
  } catch (error) {
    next(error);
  }
}

/** Para los routers que definen rutas completas y ponen el auth ruta por ruta. */
export const conMarca = [requireAuth, requireMarca];
