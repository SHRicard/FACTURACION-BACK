// Links de WhatsApp (wa.me) a partir del teléfono que cargó el administrador.
//
// En Argentina el mismo celular se escribe de mil maneras: "11 5555-1234",
// "011 15 5555-1234", "+54 9 11 5555 1234". WhatsApp lo quiere en formato
// internacional de celular: 54 + 9 + característica + número, sin el 15.

/**
 * Lleva un teléfono argentino al formato de wa.me, o null si no se puede.
 *
 * Límites conocidos: no entiende números de otros países (uno de 10 dígitos
 * se toma como argentino), y asume que es un celular: los fijos no usan
 * WhatsApp, así que no vale la pena distinguirlos.
 */
export function normalizarTelefonoAR(telefono?: string | null): string | null {
  if (!telefono) return null;

  let digitos = telefono.replace(/\D/g, "");
  if (digitos.startsWith("00")) digitos = digitos.slice(2);
  if (digitos.startsWith("54")) digitos = digitos.slice(2);
  if (digitos.startsWith("0")) digitos = digitos.slice(1);

  // Ya venía con el 9 de celular: 9 + característica + número.
  if (digitos.length === 11 && digitos.startsWith("9")) return `54${digitos}`;

  // 12 dígitos: tiene el 15 metido después de la característica. La de Buenos
  // Aires (11) tiene 2 dígitos; las del interior, 3 o 4.
  if (digitos.length === 12) {
    const posiciones = digitos.startsWith("11") ? [2] : [3, 4];
    for (const p of posiciones) {
      if (digitos.slice(p, p + 2) === "15") {
        digitos = digitos.slice(0, p) + digitos.slice(p + 2);
        break;
      }
    }
  }

  if (digitos.length === 10) return `549${digitos}`;
  return null;
}

/**
 * Link que abre WhatsApp con el mensaje escrito. Sin número abre el selector
 * de contactos, que sigue sirviendo: el administrador elige a quién mandarlo.
 */
export function enlaceWhatsApp(numero: string | null, texto: string): string {
  const base = numero ? `https://wa.me/${numero}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(texto)}`;
}
