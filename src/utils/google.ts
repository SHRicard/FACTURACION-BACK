import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { AppError, noAutorizado } from "./AppError.js";

// Verificación de los ID token que emite Google.
//
// El front (React Native + Expo) hace el login con Google y recibe un ID token
// firmado por Google. Ese token es lo único que manda al back: nunca confiamos
// en el email ni en el nombre que venga por separado del body, porque son datos
// que cualquiera puede inventar. Todo sale del token ya verificado.

export interface PerfilGoogle {
  /** El "sub" del token: id de usuario de Google, estable y único. */
  googleId: string;
  email: string;
  emailVerificado: boolean;
  nombre: string;
  avatar?: string;
}

let clienteCacheado: OAuth2Client | null = null;

/**
 * Google emite un client ID distinto por plataforma, y el "aud" del token es el
 * de la plataforma que lo pidió. Por eso aceptamos todos los que estén
 * configurados: si solo validáramos contra uno, los logins desde iOS o Android
 * fallarían con "Wrong recipient".
 */
export function clientIdsGoogle(): string[] {
  const ids = [
    process.env["GOOGLE_CLIENT_ID_WEB"],
    process.env["GOOGLE_CLIENT_ID_IOS"],
    process.env["GOOGLE_CLIENT_ID_ANDROID"],
    process.env["GOOGLE_CLIENT_ID"],
  ];

  // Set para no repetir si alguien puso el mismo id en dos variables.
  return [...new Set(ids.filter((id): id is string => Boolean(id?.trim())).map((id) => id.trim()))];
}

export const googleConfigurado = (): boolean => clientIdsGoogle().length > 0;

function obtenerCliente(): OAuth2Client {
  clienteCacheado ??= new OAuth2Client();
  return clienteCacheado;
}

/**
 * Valida firma, emisor, vencimiento y destinatario del ID token contra las
 * claves públicas de Google, y devuelve el perfil ya confiable.
 */
export async function verificarIdTokenGoogle(idToken: string): Promise<PerfilGoogle> {
  const audience = clientIdsGoogle();

  if (audience.length === 0) {
    // Config faltante: es un problema nuestro, no del que intenta entrar.
    throw new AppError("El login con Google no está configurado en el servidor", 503);
  }

  let payload: TokenPayload | undefined;
  try {
    const ticket = await obtenerCliente().verifyIdToken({ idToken, audience });
    payload = ticket.getPayload();
  } catch (error) {
    // Token vencido, firma inválida, audience que no matchea: todo es 401.
    throw noAutorizado(
      error instanceof Error && /audience|Wrong recipient/i.test(error.message)
        ? "El token de Google no es para esta aplicación. Revisá los client ID."
        : "El token de Google no es válido o venció"
    );
  }

  if (!payload?.sub) throw noAutorizado("El token de Google no trae un usuario");
  if (!payload.email) throw noAutorizado("El token de Google no trae un email");

  const perfil: PerfilGoogle = {
    googleId: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerificado: payload.email_verified === true,
    // Si la cuenta no tiene nombre cargado, usamos la parte local del email.
    nombre: payload.name?.trim() || payload.email.split("@")[0] || "Usuario",
  };

  if (payload.picture) perfil.avatar = payload.picture;

  return perfil;
}
