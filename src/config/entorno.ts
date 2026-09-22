import { esProduccion, logger } from "../utils/logger.js";
import { smtpConfigurado } from "../utils/email.js";
import { esVersionValida } from "../utils/version.js";

// Validación de la configuración al arrancar.
//
// En producción, un secreto de ejemplo o una variable que falta no se nota al
// arrancar: se nota cuando alguien pide recuperar la contraseña y el mail no
// sale, o cuando un registro ya creó al usuario y el link de bienvenida tira
// 503. Por eso el server corta ANTES de escuchar, con la lista de lo que falta.
// En desarrollo lo mismo es solo un aviso, para no trabar a nadie.
//
// Todo se lee de process.env adentro de las funciones, nunca al importar: en
// ESM los imports se evalúan antes del dotenv de server.ts (ver utils/logger.ts).

const JWT_DE_EJEMPLO = "cambiar_por_una_clave_larga_y_aleatoria";
const LARGO_MINIMO_SECRETO = 32;
const LARGO_MINIMO_SUPER_ADMIN = 12;
const MAXIMO_SALTOS_PROXY = 5;
const ESQUEMA_VALIDO = /^[a-z][a-z0-9+.-]*$/;

/** La variable, sin espacios; vacía cuenta como no seteada. */
function leer(clave: string): string | undefined {
  const valor = process.env[clave]?.trim();
  return valor ? valor : undefined;
}

/**
 * Cuántos proxies hay delante del server (TRUST_PROXY), para `trust proxy`.
 *
 * Sin setear: 1 en producción, porque el server habla HTTP plano y
 * API_PUBLIC_URL tiene que ser https, así que siempre hay al menos un proxy
 * que termina el TLS; 0 en desarrollo. Si viene, tiene que ser un entero de 0
 * a 5: cualquier otra cosa ('true', '1.5', 'x') devuelve null y el arranque
 * corta. Nunca `true`: con true Express le cree al X-Forwarded-For entero, y
 * cualquiera lo falsifica para tener un contador de rate limit nuevo por
 * request.
 */
export function saltosDeProxy(): number | null {
  const valor = leer("TRUST_PROXY");
  if (valor === undefined) return esProduccion() ? 1 : 0;
  if (!/^\d+$/.test(valor)) return null;
  const saltos = Number(valor);
  return saltos <= MAXIMO_SALTOS_PROXY ? saltos : null;
}

/** El problema de API_PUBLIC_URL en producción, o null si está bien. */
function problemaUrlPublica(valor: string | undefined): string | null {
  if (!valor) {
    return "falta API_PUBLIC_URL (la URL https pública de esta API: de ahí salen los links de los mails)";
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return `API_PUBLIC_URL no es una URL válida: ${valor}`;
  }

  if (url.protocol !== "https:") return "API_PUBLIC_URL tiene que ser https";

  const host = url.hostname;
  if (host === "localhost" || host.startsWith("127.") || host === "0.0.0.0" || host === "[::1]") {
    return "API_PUBLIC_URL no puede apuntar a esta máquina (localhost): los links se abren desde el celular";
  }
  return null;
}

/**
 * Revisa las variables de entorno. Los errores cortan el arranque en
 * producción (y los que son siempre error, en cualquier entorno); los avisos
 * solo se loguean.
 */
export function validarEntorno(): void {
  const produccion = esProduccion();
  const errores: string[] = [];
  const avisos: string[] = [];

  // En producción corta; en desarrollo avisa.
  const deProduccion = (mensaje: string): void => {
    if (produccion) errores.push(mensaje);
    else avisos.push(`${mensaje} (en producción el server no arranca así)`);
  };

  if (process.env["NODE_ENV"] === undefined) {
    avisos.push("NODE_ENV no está seteado: se trabaja como desarrollo; en el hosting va NODE_ENV=production");
  }

  // ─── Siempre ───
  const jwtSecret = leer("JWT_SECRET");
  if (!jwtSecret) errores.push("falta JWT_SECRET");
  if (!leer("MONGO_URI")) errores.push("falta MONGO_URI");

  // ─── Secretos débiles o de ejemplo ───
  if (jwtSecret) {
    if (jwtSecret === JWT_DE_EJEMPLO || /cambiar/i.test(jwtSecret)) {
      deProduccion("JWT_SECRET es el de ejemplo: con él cualquiera firma sesiones");
    } else if (jwtSecret.length < LARGO_MINIMO_SECRETO) {
      deProduccion(`JWT_SECRET tiene que tener ${LARGO_MINIMO_SECRETO} caracteres o más`);
    }
  }

  const enlacesSecret = leer("ENLACES_SECRET");
  if (enlacesSecret && enlacesSecret.length < LARGO_MINIMO_SECRETO) {
    deProduccion(`ENLACES_SECRET tiene que tener ${LARGO_MINIMO_SECRETO} caracteres o más`);
  }

  const superAdmin = leer("SUPER_ADMIN_PASSWORD");
  if (superAdmin && (superAdmin.length < LARGO_MINIMO_SUPER_ADMIN || /cambiar/i.test(superAdmin))) {
    deProduccion(
      `SUPER_ADMIN_PASSWORD es la de ejemplo o tiene menos de ${LARGO_MINIMO_SUPER_ADMIN} caracteres`
    );
  }

  // ─── Solo producción ───
  if (produccion) {
    const problema = problemaUrlPublica(leer("API_PUBLIC_URL"));
    if (problema) errores.push(problema);

    if (!smtpConfigurado()) {
      errores.push(
        "falta configurar el SMTP (MAIL_HOST, MAIL_USER y MAIL_PASS): sin mail no llega el link de recuperar contraseña"
      );
    }

    if (!leer("LEGAL_CONTACT_EMAIL")) {
      errores.push("falta LEGAL_CONTACT_EMAIL (el contacto de los documentos legales que revisa Google Play)");
    }
  }

  // ─── Siempre: valores mal escritos ───
  if (saltosDeProxy() === null) {
    errores.push(
      `TRUST_PROXY tiene que ser un número entero de 0 a ${MAXIMO_SALTOS_PROXY} (la cantidad de proxies delante), nunca "true"`
    );
  }

  for (const clave of ["APP_VERSION_MINIMA", "APP_VERSION_ULTIMA"]) {
    const version = leer(clave);
    if (version && !esVersionValida(version)) {
      errores.push(`${clave} tiene que tener la forma mayor.menor.parche, como 1.2.0`);
    }
  }

  const tienda = leer("APP_URL_TIENDA");
  if (tienda && !tienda.startsWith("https://")) {
    errores.push("APP_URL_TIENDA tiene que empezar con https://");
  }

  const esquema = leer("APP_SCHEME");
  if (esquema && !ESQUEMA_VALIDO.test(esquema)) {
    errores.push("APP_SCHEME tiene que ser un scheme válido, en minúsculas, como facturacionfront");
  }

  for (const aviso of avisos) logger.warn(`Config: ${aviso}`);

  if (errores.length) {
    for (const error of errores) logger.error(`Config: ${error}`);
    logger.error("El servidor no arranca con esta configuración.");
    process.exit(1);
  }
}
