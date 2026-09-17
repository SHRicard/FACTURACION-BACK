import { layout } from "../layout.js";
import { escaparHtml, panel, parrafo, titulo } from "../componentes.js";
import { color } from "../tokens.js";
import type { Plantilla } from "../index.js";

export interface DatosFacturaCliente {
  nombreCliente: string;
  /** La marca del usuario: el mail sale a su nombre, no al de la app. */
  nombreMarca: string;
  /** cid: del logo de la marca, si tiene. Sin logo, va el nombre en grande. */
  cidLogo?: string | undefined;
  /** "Factura N° 0012" o "Factura en curso". */
  tituloFactura: string;
  /** "$ 12.500" */
  saldo: string;
  alDia: boolean;
  vencida: boolean;
  /** "vence el 10/10/2026" / "venció el 05/09/2026". Null si está al día. */
  vencimiento: string | null;
  /** Lo que quiera agregar el usuario. */
  mensaje?: string;
}

/**
 * El mail que acompaña al PDF de la factura, con la marca del usuario.
 *
 * Todo lo que escribió alguien —el nombre del cliente, el de la marca, el
 * mensaje— pasa por escaparHtml: un nombre como "<script>" no puede terminar
 * dentro del HTML del mail.
 */
export function facturaCliente(d: DatosFacturaCliente): Plantilla {
  const cliente = escaparHtml(d.nombreCliente);
  const marca = escaparHtml(d.nombreMarca);
  // Mismo texto que el título de resumenFactura (services/pdfFactura.ts).
  const esEnCurso = d.tituloFactura === "Factura en curso";
  const deQue = esEnCurso ? "factura en curso" : d.tituloFactura;

  const asunto = esEnCurso
    ? `${d.nombreMarca} · Tu cuenta al día de hoy`
    : `${d.nombreMarca} · ${d.tituloFactura}`;

  const vencimiento = d.vencimiento
    ? d.vencimiento.charAt(0).toUpperCase() + d.vencimiento.slice(1)
    : "";

  const estado = d.alDia
    ? `<strong style="color:${color.tinta};">Estás al día:</strong> no tenés saldo pendiente.`
    : `Saldo a pagar: <strong style="color:${color.tinta};font-size:16px;">${escaparHtml(d.saldo)}</strong><br />
       ${escaparHtml(vencimiento)}`;

  const vistaPrevia = d.alDia
    ? `El detalle de tu cuenta en ${d.nombreMarca}. Estás al día.`
    : `El detalle de tu cuenta en ${d.nombreMarca}: saldo ${d.saldo}.`;

  const contenido = `
    ${titulo(`Hola, ${cliente}`)}

    ${parrafo(
      `Te mandamos el detalle de tu cuenta en <strong style="color:${color.tinta};">${marca}</strong>
       (${escaparHtml(deQue)}). Lo tenés adjunto en PDF.`
    )}

    ${panel(estado, d.vencida ? "ambar" : "lavanda")}

    ${
      d.mensaje
        ? panel(
            `<strong style="color:${color.tinta};">${marca} te escribe:</strong><br />
             ${escaparHtml(d.mensaje).replace(/\n/g, "<br />")}`
          )
        : ""
    }
  `;

  return {
    asunto,
    vistaPrevia,
    html: layout({
      vistaPrevia,
      contenido,
      marca: { nombre: d.nombreMarca, cidLogo: d.cidLogo },
      pie: `Si tenés alguna duda, respondé este mail: le llega directo a ${marca}.`,
    }),
    texto: [
      `Hola, ${d.nombreCliente}.`,
      "",
      `Te mandamos el detalle de tu cuenta en ${d.nombreMarca} (${deQue}). Lo tenés adjunto en PDF.`,
      "",
      d.alDia ? "Estás al día: no tenés saldo pendiente." : `Saldo a pagar: ${d.saldo}. ${vencimiento}.`,
      ...(d.mensaje ? ["", `${d.nombreMarca} te escribe:`, d.mensaje] : []),
      "",
      `Si tenés alguna duda, respondé este mail: le llega directo a ${d.nombreMarca}.`,
      "",
      `— ${d.nombreMarca}`,
    ].join("\n"),
  };
}
