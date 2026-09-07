// Tokens de diseño de los emails.
//
// Salen del logo de Morgana (src/emails/assets): el violeta profundo del
// wordmark y los lilas de los brillos y el vestido.

export const color = {
  // Rampa de marca, tomada del SVG del logo.
  violetaProfundo: "#4a1866",
  violeta: "#6b2392",
  violetaPrimario: "#762a9d",
  violetaMedio: "#9a45bd",
  lila: "#b059cf",
  lilaClaro: "#c46ede",

  // Tintes para fondos y paneles.
  lavandaFondo: "#f4f0f8",
  lavandaPanel: "#f9f5fc",
  lavandaBorde: "#e8ddf0",

  // Neutros para el texto.
  tinta: "#1f1626",
  textoSuave: "#5b5165",
  textoTenue: "#8b8194",

  blanco: "#ffffff",
  borde: "#ece8f0",

  ambar: "#8a6100",
  ambarFondo: "#fdf6e3",
  ambarBorde: "#f0e0b8",
} as const;

// Inter es la tipografía de la marca, pero los clientes de correo no cargan
// webfonts de forma confiable (Gmail y Outlook descartan @font-face). Va
// primero por si el sistema del lector ya la tiene, y detrás el stack nativo,
// que es lo que va a ver la mayoría.
export const fuente = {
  texto:
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  // Georgia solo para el número del código: los dígitos se distinguen mejor.
  mono: "'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
} as const;

export const medida = {
  /** Ancho estándar de un email: más que esto se corta en varios clientes. */
  ancho: 600,
  margen: 40,
} as const;
