import { layout } from "../layout.js";
import { escaparHtml, panel, parrafo, titulo } from "../componentes.js";
import { color } from "../tokens.js";
import { NOMBRE_APLICACION } from "../../legal/documentos.js";
import type { Plantilla } from "../index.js";

export interface DatosCuentaVinculada {
  nombre: string;
  /** A dónde mandar a la persona si no fue ella la que entró con Google. */
  urlRecuperar: string;
}

/**
 * Aviso de que una cuenta con contraseña quedó vinculada a Google (K13).
 *
 * Al vincular se borra la contraseña y se cierran las sesiones: si alguien
 * había creado la cuenta con un email ajeno y una contraseña suya, la pierde.
 * Este mail le avisa a la dueña real del email, y si no fue ella, le da el
 * camino para recuperar la cuenta.
 */
export function cuentaVinculada({ nombre, urlRecuperar }: DatosCuentaVinculada): Plantilla {
  const vistaPrevia = "Desde ahora entrás con Google. Tu contraseña anterior dejó de funcionar.";

  const contenido = `
    ${titulo("Vinculamos tu cuenta con Google")}

    ${parrafo(
      `Hola ${escaparHtml(nombre)}. Entraste con Google usando el mismo mail de tu cuenta,
       así que las unimos. Desde ahora entrás con «Continuar con Google»: tu contraseña
       anterior dejó de funcionar y cerramos las sesiones que estaban abiertas.`
    )}

    ${panel(
      `<strong>¿No fuiste vos?</strong> Recuperá tu cuenta desde
       <a href="${urlRecuperar}" style="color:${color.ambar};text-decoration:underline;">este link</a>.`,
      "ambar"
    )}
  `;

  return {
    asunto: `Vinculamos tu cuenta de ${NOMBRE_APLICACION} con Google`,
    vistaPrevia,
    html: layout({ vistaPrevia, contenido }),
    texto: [
      `Hola ${nombre},`,
      "",
      "Entraste con Google usando el mismo mail de tu cuenta, así que las unimos.",
      "Desde ahora entrás con «Continuar con Google»: tu contraseña anterior dejó",
      "de funcionar y cerramos las sesiones que estaban abiertas.",
      "",
      `¿No fuiste vos? Recuperá tu cuenta desde este link: ${urlRecuperar}`,
      "",
      `— ${NOMBRE_APLICACION}`,
    ].join("\n"),
  };
}
