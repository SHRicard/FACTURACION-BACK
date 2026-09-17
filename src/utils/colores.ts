/**
 * Cuentas con colores hex (#rrggbb). Las usan los mails y el PDF.
 */

const canales = (hex: string): number[] =>
  [0, 1, 2].map((i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16));

/** Mezcla dos colores hex. t=0 devuelve el primero, t=1 el segundo. */
export function mezclar(desde: string, hasta: string, t: number): string {
  const a = canales(desde);
  const b = canales(hasta);
  const val = (i: number) => Math.round(a[i]! + (b[i]! - a[i]!) * t);
  return `#${[0, 1, 2].map((i) => val(i).toString(16).padStart(2, "0")).join("")}`;
}

/** Luminancia relativa, como la define WCAG 2. */
function luminancia(hex: string): number {
  const [r, g, b] = canales(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** Contraste WCAG entre dos colores: de 1 (iguales) a 21 (negro sobre blanco). */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro! + 0.05) / (oscuro! + 0.05);
}

/**
 * El mismo color, oscurecido lo justo para llegar a `minimo` de contraste
 * sobre blanco (4.5 es el mínimo de WCAG AA para texto).
 *
 * Un amarillo elegido por la marca sigue siendo de la familia del amarillo,
 * pero un texto en ese tono no se pierde en el papel. Si ya se lee, vuelve
 * tal cual.
 */
export function legibleSobreBlanco(hex: string, minimo = 4.5): string {
  for (let paso = 0; paso <= 20; paso++) {
    const candidato = mezclar(hex, "#000000", paso / 20);
    if (contraste(candidato, "#ffffff") >= minimo) return candidato;
  }
  return "#000000";
}
