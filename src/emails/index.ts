import { CID_LOGO } from "./layout.js";
import { rutaAsset } from "../utils/assets.js";

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

/**
 * Un adjunto del mail. Dos usos:
 *   - embebido (el logo): con `cid`, y el HTML lo referencia como cid:<cid>
 *   - archivo (el PDF de la factura): con `content`, sin `cid`
 */
export interface Adjunto {
  filename: string;
  path?: string;
  content?: Buffer;
  contentType?: string;
  cid?: string;
}

export const rutaLogo = rutaAsset("logo-morgana-640.png");

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
export { facturaCliente, type DatosFacturaCliente } from "./plantillas/facturaCliente.js";
