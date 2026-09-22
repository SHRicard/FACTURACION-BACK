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
  /** La cuenta no tiene contraseña: entra con Google. */
  usaGoogle?: boolean;
}

export function recuperarPassword({
  nombre,
  url,
  minutos,
  usaGoogle = false,
}: DatosRecuperar): Plantilla {
  const vistaPrevia = `Elegí una contraseña nueva. El link vence en ${minutos} minutos.`;

  // El login ya no dice "esta cuenta usa Google" (no revela qué emails usan la
  // app, K14): la pista llega acá, al mail de la persona.
  const indicacion = usaGoogle
    ? "Tu cuenta entra con Google: podés seguir entrando con «Continuar con Google». Si además querés una contraseña, elegila con este link."
    : "Tocá el botón: se abre una página donde elegís la contraseña nueva. Después volvés a la app y entrás con ella.";

  // Una cuenta de Google no tiene "contraseña actual": el cierre no puede
  // decir que sigue funcionando.
  const siNoFuisteVos = usaGoogle
    ? "Si no pediste esto, ignorá este mail: tu cuenta sigue igual y nadie puede ponerle una contraseña sin este link."
    : "Si no pediste este cambio, podés ignorar este mail: tu contraseña actual sigue funcionando y nadie puede cambiarla sin este link.";

  const contenido = `
    ${titulo("Recuperá tu contraseña")}

    ${parrafo(
      `Hola ${nombre}. Recibimos un pedido para cambiar la contraseña de tu cuenta.
       ${indicacion}`
    )}

    ${boton(url, "Elegir contraseña nueva")}

    ${panel(
      `⏱&nbsp; El link vence en <strong style="color:${color.tinta};">${minutos} minutos</strong>
       y se puede usar una sola vez.`,
      "ambar"
    )}

    ${urlDeRespaldo(url)}

    ${parrafo(siNoFuisteVos, `font-size:14px;line-height:22px;color:${color.textoTenue};`)}
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
      indicacion,
      `El link vence en ${minutos} minutos y se usa una sola vez:`,
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
