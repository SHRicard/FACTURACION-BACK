import path from "node:path";
import { fileURLToPath } from "node:url";
import { CID_LOGO } from "./layout.js";

/** Un email listo para mandar: asunto, HTML, texto plano y vista previa. */
export interface Plantilla {
  asunto: string;
  html: string;
  /** Alternativa en texto plano. Obligatoria: sube la reputación del remitente
   *  y es lo que ven los lectores que bloquean HTML. */
  texto: string;
  /** Lo que se lee en la bandeja al lado del asunto. */
  vistaPrevia: string;
}

/** Adjunto embebido: se referencia desde el HTML como cid:<cid>. */
export interface Adjunto {
  filename: string;
  path: string;
  cid: string;
}

// En dist/ los assets se copian junto al código compilado (ver el script
// "build" del package.json), así que esta ruta vale tanto corriendo con tsx
// desde src/ como corriendo el JS de dist/.
const carpetaActual = path.dirname(fileURLToPath(import.meta.url));

export const rutaLogo = path.join(carpetaActual, "assets", "logo-morgana-640.png");

/**
 * El logo va adjunto y embebido, no como URL: los assets no están publicados
 * en ningún hosting. Además así se ve aunque el cliente bloquee imágenes
 * remotas, que es el comportamiento por defecto de Outlook y de Gmail con
 * remitentes nuevos.
 */
export const adjuntoLogo = (): Adjunto => ({
  filename: "morgana.png",
  path: rutaLogo,
  cid: CID_LOGO,
});

export { CID_LOGO } from "./layout.js";
export { bienvenida, type DatosBienvenida } from "./plantillas/bienvenida.js";
export { recuperarPassword, type DatosRecuperar } from "./plantillas/recuperarPassword.js";
export { passwordCambiado, type DatosPasswordCambiado } from "./plantillas/passwordCambiado.js";
