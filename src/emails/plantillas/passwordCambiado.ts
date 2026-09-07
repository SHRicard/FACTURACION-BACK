import { layout } from "../layout.js";
import { panel, parrafo, titulo } from "../componentes.js";
import type { Plantilla } from "../index.js";

export interface DatosPasswordCambiado {
  nombre: string;
  /** A dónde mandar al usuario si no reconoce el cambio. */
  urlRecuperar: string;
}

export function passwordCambiado({ nombre, urlRecuperar }: DatosPasswordCambiado): Plantilla {
  const vistaPrevia = "Confirmamos el cambio de contraseña de tu cuenta.";

  const contenido = `
    ${titulo("Tu contraseña fue cambiada")}

    ${parrafo(
      `Hola ${nombre}. Te confirmamos que la contraseña de tu cuenta se cambió recién.
       Las sesiones que tenías abiertas en otros dispositivos se cerraron.`
    )}

    ${panel(
      `<strong>¿No fuiste vos?</strong> Recuperá tu cuenta cuanto antes desde
       <a href="${urlRecuperar}" style="color:#8a6100;text-decoration:underline;">este link</a>.`,
      "ambar"
    )}
  `;

  return {
    asunto: "Tu contraseña de Morgana fue cambiada",
    vistaPrevia,
    html: layout({ vistaPrevia, contenido }),
    texto: [
      `Hola ${nombre},`,
      "",
      "Te confirmamos que la contraseña de tu cuenta de Morgana se cambió recién.",
      "Las sesiones abiertas en otros dispositivos se cerraron.",
      "",
      `Si no fuiste vos, recuperá tu cuenta cuanto antes: ${urlRecuperar}`,
      "",
      "— Morgana · Gestión de cuentas corrientes",
    ].join("\n"),
  };
}
