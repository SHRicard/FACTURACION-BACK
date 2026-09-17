import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger.js";
import type { Adjunto } from "../emails/index.js";

// Envío de mails.
//
// Si están las variables MAIL_* manda el mail de verdad. Si no, lo escribe en
// la consola: así se puede desarrollar todo el flujo de recuperación de
// contraseña sin configurar nada.
//
// Los nombres SMTP_* se siguen aceptando como alias, para no romper un .env
// que ya venía con esa convención.

export interface Mail {
  para: string;
  asunto: string;
  html: string;
  texto?: string;
  /** Adjuntos: el logo embebido (cid:) y archivos como el PDF de una factura. */
  adjuntos?: Adjunto[];
  /**
   * A dónde van las respuestas. El mail sale desde MAIL_FROM (la plataforma);
   * sin esto, cuando el cliente responde le escribe a Morgana y no al negocio.
   */
  responderA?: string;
}

export interface ResultadoEnvio {
  enviado: boolean;
  messageId?: string;
  motivo?: string;
}

export interface Plantilla {
  asunto: string;
  html: string;
  texto: string;
}

let transportCacheado: Transporter | null = null;

/** Primera de las claves que esté definida y no vacía. */
function leerEnv(...claves: string[]): string | undefined {
  for (const clave of claves) {
    const valor = process.env[clave];
    if (valor !== undefined && valor.trim() !== "") return valor.trim();
  }
  return undefined;
}

export interface ConfigMail {
  host?: string;
  port: number;
  user?: string;
  pass?: string;
  from: string;
  secure: boolean;
  rejectUnauthorized: boolean;
}

export function configMail(): ConfigMail {
  const port = Number(leerEnv("MAIL_PORT", "SMTP_PORT") ?? 587);
  const secureEnv = leerEnv("MAIL_SECURE", "SMTP_SECURE");
  const user = leerEnv("MAIL_USER", "SMTP_USER");

  const config: ConfigMail = {
    port,
    // Si no se especifica, 465 es SSL directo y el resto (587, 25) usa STARTTLS.
    secure: secureEnv !== undefined ? secureEnv === "true" : port === 465,
    from: leerEnv("MAIL_FROM") ?? user ?? "no-reply@cuentacorriente.app",
    // Solo poner en "false" contra un SMTP interno con certificado propio.
    rejectUnauthorized: leerEnv("MAIL_TLS_REJECT_UNAUTHORIZED") !== "false",
  };

  const host = leerEnv("MAIL_HOST", "SMTP_HOST");
  if (host !== undefined) config.host = host;
  if (user !== undefined) config.user = user;

  // Las app password de Gmail se copian como "xxxx xxxx xxxx xxxx"; los espacios
  // no molestan, pero las comillas sueltas sí, y dotenv solo saca las que envuelven.
  const pass = leerEnv("MAIL_PASS", "SMTP_PASS");
  if (pass !== undefined) config.pass = pass;

  return config;
}

export const smtpConfigurado = (): boolean => {
  const { host, user, pass } = configMail();
  return Boolean(host && user && pass);
};

function obtenerTransport(): Transporter {
  if (transportCacheado) return transportCacheado;

  const { host, port, secure, user, pass, rejectUnauthorized } = configMail();

  transportCacheado = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: user as string, pass: pass as string },
    tls: { rejectUnauthorized },
  });

  return transportCacheado;
}

// Comprueba que el SMTP responda. La llamamos al arrancar para enterarnos ahí
// de que las credenciales están mal, y no cuando un usuario pide un reseteo.
export async function verificarEmail(): Promise<boolean> {
  if (!smtpConfigurado()) {
    logger.warn("SMTP sin configurar: los mails se van a imprimir en la consola");
    return false;
  }

  try {
    const { host, port, user } = configMail();
    await obtenerTransport().verify();
    logger.success(`SMTP conectado (${user} vía ${host}:${port})`);
    return true;
  } catch (error) {
    logger.error("SMTP no responde, los mails van a la consola:");
    logger.error(error);
    transportCacheado = null;
    return false;
  }
}

export async function enviarEmail({
  para,
  asunto,
  html,
  texto,
  adjuntos,
  responderA,
}: Mail): Promise<ResultadoEnvio> {
  const { from } = configMail();

  if (!smtpConfigurado()) {
    // Modo desarrollo: el mail va a la consola, con el texto plano que suele
    // traer el link. Alcanza para copiarlo y seguir probando.
    logger.info("📧 Email (no enviado, SMTP sin configurar)");
    logger.info(`   para:   ${para}`);
    logger.info(`   asunto: ${asunto}`);
    if (responderA) logger.info(`   responder a: ${responderA}`);
    // Los archivos adjuntos se nombran con su peso, para ver que el PDF salió.
    const archivos = adjuntos?.filter((a) => !a.cid) ?? [];
    if (archivos.length) {
      const lista = archivos.map((a) =>
        a.content ? `${a.filename} (${Math.ceil(a.content.length / 1024)} KB)` : a.filename
      );
      logger.info(`   adjuntos: ${lista.join(", ")}`);
    }
    if (texto) logger.info(`   ${texto.trim().replace(/\n/g, "\n   ")}`);
    return { enviado: false, motivo: "SMTP sin configurar" };
  }

  try {
    const info = await obtenerTransport().sendMail({
      from,
      to: para,
      subject: asunto,
      html,
      text: texto,
      ...(responderA ? { replyTo: responderA } : {}),
      ...(adjuntos?.length ? { attachments: adjuntos } : {}),
    });
    logger.info(`📧 Email enviado a ${para} (${info.messageId})`);
    return { enviado: true, messageId: info.messageId };
  } catch (error) {
    // No propagamos: que falle el mail no tiene que romper la request. El
    // usuario ve el mensaje genérico y nosotros vemos el error en la consola.
    logger.error(`No se pudo enviar el email a ${para}:`);
    logger.error(error);
    return { enviado: false, motivo: error instanceof Error ? error.message : String(error) };
  }
}
