import { color } from "../emails/tokens.js";
import { contraste, legibleSobreBlanco, mezclar } from "../utils/colores.js";

/**
 * Los colores del PDF, a partir de los dos que eligió la marca.
 *
 *   primario    → nombre de la marca, saldo grande, títulos, rótulo "PAGADA"
 *   secundario  → acentos: "SALDO A PAGAR", montos de los pagos
 *   relleno     → la barra de lo cobrado
 *   panel/borde → tintes muy claros del primario, para el bloque del saldo
 *
 * Sin colores elegidos sale la paleta de siempre, los violetas de la app.
 *
 * Lo que va como texto se oscurece si hace falta: la marca elige el color,
 * pero el cliente tiene que poder leer cuánto debe. El ámbar de "vencida" no
 * sale de acá: es un aviso, no un color de la marca.
 */
export interface PaletaPdf {
  primario: string;
  secundario: string;
  relleno: string;
  panel: string;
  borde: string;
}

const POR_DEFECTO: PaletaPdf = {
  primario: color.violetaProfundo,
  secundario: color.violetaPrimario,
  relleno: color.violetaPrimario,
  panel: color.lavandaPanel,
  borde: color.lavandaBorde,
};

const BLANCO = "#ffffff";

export function paletaPdf(marca: {
  colorPrimario?: string | undefined;
  colorSecundario?: string | undefined;
}): PaletaPdf {
  const { colorPrimario, colorSecundario } = marca;
  if (!colorPrimario && !colorSecundario) return POR_DEFECTO;

  const base = colorPrimario ?? POR_DEFECTO.primario;
  // Con un solo color elegido, los acentos van con ese mismo.
  const acento = colorSecundario ?? base;
  const primario = legibleSobreBlanco(base);

  return {
    primario,
    secundario: legibleSobreBlanco(acento),
    // La barra no es texto: va con el color tal cual, salvo que sea tan claro
    // que se pierda en el blanco del bloque.
    relleno: contraste(acento, BLANCO) >= 1.5 ? acento : legibleSobreBlanco(acento, 1.5),
    // Los tintes salen del primario ya oscurecido: con un amarillo o un
    // blanco crudo, el borde del bloque quedaría blanco sobre blanco.
    panel: mezclar(primario, BLANCO, 0.95),
    borde: mezclar(primario, BLANCO, 0.82),
  };
}
