import { layout } from "../layout.js";
import { boton, panel, parrafo, pasos, titulo } from "../componentes.js";
import { color } from "../tokens.js";
import type { Plantilla } from "../index.js";

export interface DatosBienvenida {
  nombre: string;
  email: string;
  /** A dónde manda el botón. Por defecto, el login del front. */
  urlApp: string;
}

export function bienvenida({ nombre, email, urlApp }: DatosBienvenida): Plantilla {
  const contenido = `
    ${titulo(`Te damos la bienvenida,<br />${nombre}`)}

    ${parrafo(
      `Tu cuenta ya está lista. Desde ahora podés llevar la cuenta corriente de cada
       cliente, cargar tus productos y registrar ventas y pagos en un solo lugar.`
    )}

    ${pasos([
      {
        titulo: "Cargá tus productos",
        detalle: "Nombre, precio y stock. Es lo que después vas a usar en cada ticket.",
      },
      {
        titulo: "Sumá tus clientes",
        detalle: "A cada uno le definís su límite de crédito y se le abre la cuenta corriente.",
      },
      {
        titulo: "Registrá ventas y pagos",
        detalle: "El saldo se actualiza solo y el historial queda guardado.",
      },
    ])}

    ${boton(urlApp, "Entrar a mi cuenta")}

    ${panel(
      `Tu cuenta quedó asociada a <strong style="color:${color.tinta};">${email}</strong>.
       Vas a usar ese mail para iniciar sesión.`
    )}
  `;

  return {
    asunto: "Tu cuenta de Morgana ya está lista",
    vistaPrevia: `${nombre}, ya podés empezar a cargar tus clientes y productos.`,
    html: layout({
      vistaPrevia: `${nombre}, ya podés empezar a cargar tus clientes y productos.`,
      contenido,
    }),
    texto: [
      `Te damos la bienvenida, ${nombre}.`,
      "",
      "Tu cuenta de Morgana ya está lista. Para empezar:",
      "",
      "  1. Cargá tus productos (nombre, precio y stock).",
      "  2. Sumá tus clientes y definí el límite de crédito de cada uno.",
      "  3. Registrá ventas y pagos: el saldo se actualiza solo.",
      "",
      `Entrá acá: ${urlApp}`,
      "",
      `Tu cuenta quedó asociada a ${email}. Vas a usar ese mail para iniciar sesión.`,
      "",
      "— Morgana · Gestión de cuentas corrientes",
    ].join("\n"),
  };
}
