import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import { errorDeCampo, noAutorizado } from "../utils/AppError.js";
import { ROL_POR_DEFECTO } from "../config/roles.js";
import { enmascararEmail, logger } from "../utils/logger.js";
import type { PerfilGoogle } from "../utils/google.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../legal/documentos.js";

/** Qué pasó al resolver la cuenta. El caller decide qué hacer con cada caso. */
export type ResultadoGoogle =
  | { usuario: UsuarioDocument; caso: "existente" }
  | { usuario: UsuarioDocument; caso: "vinculada"; teniaPassword: boolean }
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
  // password y passwordCambiadoEn tienen select:false; hacen falta para
  // saber si tenía contraseña y para cerrar sus sesiones.
  const porEmail = await Usuario.findOne({ email: perfil.email }).select(
    "+password +passwordCambiadoEn",
  );
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

    // Pre-secuestro: alguien pudo registrarse ANTES con este email (que no es
    // suyo) y una contraseña suya, y esperar a que la dueña real entre con
    // Google. Si la contraseña sobreviviera a la vinculación, esa persona
    // seguiría entrando a la cuenta. Por eso se borra la contraseña y el token
    // de reseteo que hubiera, y se cierran las sesiones abiertas; la ruta le
    // manda un mail de aviso a la dueña del email.
    const teniaPassword = Boolean(porEmail.password);
    if (teniaPassword) {
      porEmail.set("password", undefined);
      porEmail.set("resetPasswordToken", undefined);
      porEmail.set("resetPasswordExpira", undefined);
      // A mano, porque el pre('save') de Usuario.ts solo lo toca cuando se
      // guarda una contraseña nueva, no cuando queda vacía. El `required` de
      // password no molesta: ya hay googleId.
      //
      // 1 s para atrás: requireAuth compara passwordCambiadoEn contra el iat
      // del JWT, que va en segundos. Así el token que se emite en esta misma
      // respuesta sigue valiendo y todos los anteriores no.
      porEmail.passwordCambiadoEn = new Date(Date.now() - 1000);
    }
    await porEmail.save();

    logger.info(
      `Cuenta local vinculada con Google: ${enmascararEmail(porEmail.email)}${
        teniaPassword ? " (se borró la contraseña anterior)" : ""
      }`,
    );
    return { usuario: porEmail, caso: "vinculada", teniaPassword };
  }

  // 3) No existe: cuenta nueva. Igual que el registro, siempre administrador.
  //
  // Exigimos el email verificado también acá: si no, dos personas distintas
  // podrían terminar con cuentas sobre el mismo email.
  if (!perfil.emailVerificado) {
    throw noAutorizado("Google no confirmó ese email. Probá con otra cuenta.");
  }

  if (!aceptaTerminos) {
    throw errorDeCampo(
      "aceptoTerminosYCondiciones",
      "Tenés que aceptar los términos y condiciones y la política de privacidad",
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

  logger.success(`Cuenta nueva con Google: ${enmascararEmail(usuario.email)}`);
  return { usuario, caso: "creada" };
}
