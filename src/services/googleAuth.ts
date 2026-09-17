import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import { datosInvalidos, noAutorizado } from "../utils/AppError.js";
import { ROL_POR_DEFECTO } from "../config/roles.js";
import { logger } from "../utils/logger.js";
import type { PerfilGoogle } from "../utils/google.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../legal/documentos.js";

/** Qué pasó al resolver la cuenta. El caller decide qué hacer con cada caso. */
export type ResultadoGoogle =
  | { usuario: UsuarioDocument; caso: "existente" }
  | { usuario: UsuarioDocument; caso: "vinculada" }
  | { usuario: UsuarioDocument; caso: "creada" };

/**
 * Encuentra, vincula o crea la cuenta que corresponde a un perfil de Google
 * ya verificado.
 *
 * Está separado de la ruta porque acá está la parte delicada: decidir cuándo
 * una cuenta de Google puede tomar el control de una cuenta local existente.
 */
export async function resolverUsuarioGoogle(
  perfil: PerfilGoogle,
  aceptaTerminos = false,
): Promise<ResultadoGoogle> {
  // 1) Ya entró con Google antes. Es el camino normal.
  const porGoogleId = await Usuario.findOne({ googleId: perfil.googleId });
  if (porGoogleId) return { usuario: porGoogleId, caso: "existente" };

  // 2) Hay una cuenta local con ese email: la vinculamos.
  const porEmail = await Usuario.findOne({ email: perfil.email });
  if (porEmail) {
    // Solo si Google confirma que el email está verificado. Si no, alguien
    // podría crear una cuenta de Google con un email ajeno y quedarse con la
    // cuenta local de esa persona.
    if (!perfil.emailVerificado) {
      throw noAutorizado(
        "Google no confirmó que ese email sea tuyo. Entrá con tu contraseña.",
      );
    }

    porEmail.googleId = perfil.googleId;
    if (!porEmail.avatar && perfil.avatar) porEmail.avatar = perfil.avatar;
    await porEmail.save();

    logger.info(`Cuenta local vinculada con Google: ${porEmail.email}`);
    return { usuario: porEmail, caso: "vinculada" };
  }

  // 3) No existe: cuenta nueva. Igual que el registro, siempre administrador.
  //
  // Exigimos el email verificado también acá: si no, dos personas distintas
  // podrían terminar con cuentas sobre el mismo email.
  if (!perfil.emailVerificado) {
    throw noAutorizado("Google no confirmó ese email. Probá con otra cuenta.");
  }

  if (!aceptaTerminos) {
    throw datosInvalidos(
      "Tenés que aceptar los términos y condiciones y la política de privacidad",
      { campo: "aceptoTerminosYCondiciones" },
    );
  }

  const usuario = await Usuario.create({
    nombre: perfil.nombre,
    email: perfil.email,
    rol: ROL_POR_DEFECTO,
    proveedor: "google",
    googleId: perfil.googleId,
    aceptoTerminosYCondiciones: aceptaTerminos,
    ...(aceptaTerminos
      ? {
          terminosYCondicionesVersion: VERSION_DOCUMENTOS_LEGALES,
          terminosYCondicionesAceptadosEn: new Date(),
        }
      : {}),
    ...(perfil.avatar ? { avatar: perfil.avatar } : {}),
  });

  logger.success(`Cuenta nueva con Google: ${usuario.email}`);
  return { usuario, caso: "creada" };
}
