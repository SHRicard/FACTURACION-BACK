import { layout } from "../layout.js";
import { boton, panel, parrafo, titulo, urlDeRespaldo } from "../componentes.js";
import { color } from "../tokens.js";
import type { Plantilla } from "../index.js";

export interface DatosRecuperar {
  nombre: string;
  /** El link con el token, ya armado. */
  url: string;
  /** Cuántos minutos vive el link. */
  minutos: number;
}

export function recuperarPassword({ nombre, url, minutos }: DatosRecuperar): Plantilla {
  const vistaPrevia = `Elegí una contraseña nueva. El link vence en ${minutos} minutos.`;

  const contenido = `
    ${titulo("Recuperá tu contraseña")}

    ${parrafo(
      `Hola ${nombre}. Recibimos un pedido para cambiar la contraseña de tu cuenta.
       Tocá el botón y elegí una nueva.`
    )}

    ${boton(url, "Elegir contraseña nueva")}

    ${panel(
      `⏱&nbsp; El link vence en <strong style="color:${color.tinta};">${minutos} minutos</strong>
       y se puede usar una sola vez.`,
      "ambar"
    )}

    ${urlDeRespaldo(url)}

    ${parrafo(
      `Si no pediste este cambio, podés ignorar este mail: tu contraseña actual
       sigue funcionando y nadie puede cambiarla sin este link.`,
      `font-size:14px;line-height:22px;color:${color.textoTenue};`
    )}
  `;

  return {
    asunto: "Recuperá tu contraseña de Morgana",
    vistaPrevia,
    html: layout({
      vistaPrevia,
      contenido,
      pie: "Por seguridad, nunca compartas este link con nadie.",
    }),
    texto: [
      `Hola ${nombre},`,
      "",
      "Recibimos un pedido para cambiar la contraseña de tu cuenta de Morgana.",
      `Entrá a este link para elegir una nueva (vence en ${minutos} minutos y se usa una sola vez):`,
      "",
      `  ${url}`,
      "",
      "Si no pediste este cambio, ignorá este mail: tu contraseña actual sigue",
      "funcionando y nadie puede cambiarla sin este link.",
      "",
      "— Morgana · Gestión de cuentas corrientes",
    ].join("\n"),
  };
}
