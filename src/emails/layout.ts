import { color, fuente, medida } from "./tokens.js";
import { fileteMarca, preheader } from "./componentes.js";

/**
 * El logo se manda adjunto y se referencia con cid:, no con una URL. Así se ve
 * aunque el proyecto no tenga los assets publicados en ningún lado, que es el
 * caso hoy. Si algún día hay CDN, alcanza con cambiar el src por la URL.
 */
export const CID_LOGO = "logo-morgana";

export interface OpcionesLayout {
  /** Texto de vista previa, el que se lee en la bandeja al lado del asunto. */
  vistaPrevia: string;
  /** El cuerpo ya armado. */
  contenido: string;
  /** Línea extra en el pie, opcional. */
  pie?: string;
}

export function layout({ vistaPrevia, contenido, pie }: OpcionesLayout): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no" />
  <!-- Le decimos al cliente que el diseño es claro, para que no lo invierta a lo bruto. -->
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>Morgana</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* Gmail descarta buena parte de esto: son mejoras, nunca lo que sostiene el diseño. */
    body { margin:0 !important; padding:0 !important; width:100% !important; }
    table { border-collapse:collapse; }
    img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
    a { text-decoration:none; }

    @media only screen and (max-width:620px) {
      .contenedor { width:100% !important; }
      .relleno    { padding-left:24px !important; padding-right:24px !important; }
      .relleno-xl { padding-left:24px !important; padding-right:24px !important; }
      .titulo-r   { font-size:23px !important; line-height:31px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:${color.lavandaFondo};">
  ${preheader(vistaPrevia)}

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${color.lavandaFondo};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${medida.ancho}" class="contenedor"
               style="width:${medida.ancho}px;max-width:${medida.ancho}px;background-color:${color.blanco};border-radius:16px;overflow:hidden;border:1px solid ${color.borde};">

          <!-- Cabecera: el logo respira, sin nada que le compita -->
          <tr>
            <td align="center" class="relleno" style="padding:38px 40px 30px;">
              <img src="cid:${CID_LOGO}" width="220" height="80" alt="Morgana"
                   style="display:block;width:220px;height:80px;max-width:220px;" />
            </td>
          </tr>

          <tr><td>${fileteMarca()}</td></tr>

          <!-- Cuerpo -->
          <tr>
            <td class="relleno-xl" style="padding:36px 44px 8px;">
              ${contenido}
            </td>
          </tr>

          <!-- Pie -->
          <tr>
            <td class="relleno" style="padding:8px 44px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="border-top:1px solid ${color.borde};padding-top:22px;font-family:${fuente.texto};font-size:13px;line-height:21px;color:${color.textoTenue};">
                    ${pie ? `<p style="margin:0 0 10px;">${pie}</p>` : ""}
                    <p style="margin:0;">
                      Este mail se envió automáticamente desde tu cuenta de
                      <strong style="color:${color.violetaPrimario};font-weight:600;">Morgana</strong>.
                      No hace falta que lo respondas.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>

        <p style="margin:20px 0 0;font-family:${fuente.texto};font-size:12px;line-height:18px;color:${color.textoTenue};">
          Morgana · Gestión de cuentas corrientes
        </p>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
