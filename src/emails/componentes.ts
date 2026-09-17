import { color, fuente } from "./tokens.js";
import { mezclar } from "../utils/colores.js";

// Piezas sueltas para armar un email.
//
// Todo va con <table> y estilos inline a propósito: Outlook renderiza con el
// motor de Word (sin flex ni grid) y Gmail descarta gran parte de un <style>.
// Es feo comparado con una página web, pero es lo que se ve igual en todos lados.

export const escaparHtml = (texto: string): string =>
  texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Texto que el cliente muestra como vista previa, al lado del asunto. */
export const preheader = (texto: string): string => `
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${escaparHtml(texto)}
    <!-- Relleno para que el cliente no siga tomando texto del cuerpo. -->
    ${"&#847;&zwnj;&nbsp;".repeat(60)}
  </div>
`;

export const titulo = (texto: string): string => `
  <h1 style="margin:0 0 16px;font-family:${fuente.texto};font-size:26px;line-height:34px;font-weight:600;color:${color.tinta};letter-spacing:-0.4px;">
    ${texto}
  </h1>
`;

export const parrafo = (html: string, extra = ""): string => `
  <p style="margin:0 0 18px;font-family:${fuente.texto};font-size:16px;line-height:26px;color:${color.textoSuave};${extra}">
    ${html}
  </p>
`;

/**
 * Botón "a prueba de balas": el bloque VML lo dibuja Outlook, que ignora el
 * border-radius y el padding de un <a>. El resto de los clientes salta ese
 * bloque por el comentario condicional y usa el <a> de abajo.
 */
export const boton = (url: string, texto: string): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 28px;">
    <tr>
      <td align="center" bgcolor="${color.violetaPrimario}" style="border-radius:10px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${url}" style="height:50px;v-text-anchor:middle;width:260px;" arcsize="20%"
          stroke="f" fillcolor="${color.violetaPrimario}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:600;">${texto}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${url}"
           style="display:inline-block;padding:15px 34px;font-family:${fuente.texto};font-size:16px;font-weight:600;line-height:20px;color:${color.blanco};text-decoration:none;border-radius:10px;background-color:${color.violetaPrimario};">
          ${texto}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>
`;

/** Panel suave para destacar un aviso sin gritar. */
export const panel = (html: string, tono: "lavanda" | "ambar" = "lavanda"): string => {
  const fondo = tono === "ambar" ? color.ambarFondo : color.lavandaPanel;
  const borde = tono === "ambar" ? color.ambarBorde : color.lavandaBorde;
  const texto = tono === "ambar" ? color.ambar : color.textoSuave;

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
    <tr>
      <td style="padding:16px 20px;background-color:${fondo};border:1px solid ${borde};border-radius:10px;font-family:${fuente.texto};font-size:14px;line-height:22px;color:${texto};">
        ${html}
      </td>
    </tr>
  </table>
`;
};

/** El link crudo, para cuando el botón no se puede tocar (o no se ve). */
export const urlDeRespaldo = (url: string): string => `
  <p style="margin:0 0 6px;font-family:${fuente.texto};font-size:13px;line-height:20px;color:${color.textoTenue};">
    ¿No funciona el botón? Copiá y pegá este link en tu navegador:
  </p>
  <p style="margin:0 0 28px;font-family:${fuente.mono};font-size:12px;line-height:20px;word-break:break-all;">
    <a href="${url}" style="color:${color.violetaPrimario};text-decoration:underline;">${url}</a>
  </p>
`;

/** Lista de pasos numerados. Va en tabla porque <ol> se ve distinto en cada cliente. */
export const pasos = (items: { titulo: string; detalle: string }[]): string => `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:4px 0 28px;">
    ${items
      .map(
        (item, i) => `
    <tr>
      <td width="40" valign="top" style="padding:0 0 18px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="28" height="28" align="center" valign="middle"
                style="width:28px;height:28px;background-color:${color.violetaPrimario};border-radius:14px;mso-padding-alt:0;font-family:${fuente.texto};font-size:13px;font-weight:700;color:${color.blanco};text-align:center;">
              ${i + 1}
            </td>
          </tr>
        </table>
      </td>
      <td valign="top" style="padding:0 0 18px;font-family:${fuente.texto};">
        <div style="font-size:15px;font-weight:600;line-height:22px;color:${color.tinta};">${item.titulo}</div>
        <div style="font-size:14px;line-height:22px;color:${color.textoSuave};">${item.detalle}</div>
      </td>
    </tr>`
      )
      .join("")}
  </table>
`;

/**
 * Filete degradado con la rampa del logo.
 *
 * Ningún cliente de correo soporta linear-gradient de forma confiable, así que
 * el degradado se arma con celdas contiguas. Con pocos tramos se ve a bandas:
 * interpolando ~14 pasos la transición ya se lee continua.
 */
export const fileteMarca = (tramos = 14): string => {
  const celdas = Array.from({ length: tramos }, (_, i) => {
    const t = tramos === 1 ? 0 : i / (tramos - 1);
    return `<td height="4" style="height:4px;line-height:4px;font-size:0;background-color:${mezclar(
      color.violeta,
      color.lilaClaro,
      t
    )};">&nbsp;</td>`;
  });

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="table-layout:fixed;">
    <tr>${celdas.join("")}</tr>
  </table>
`;
};
