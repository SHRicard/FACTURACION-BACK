// Logger con niveles y colores, pensado para ver qué pasa mientras desarrollamos.
//
// El nivel se controla con LOG_LEVEL: debug | info | warn | error | silent
// Si no está seteado: "debug" en desarrollo, "info" con NODE_ENV=production.
//
// Cada línea arranca con la marca de tiempo: en desarrollo, la hora local
// (alcanza para seguir la consola); en producción, fecha y hora ISO en UTC,
// porque los logs del hosting se leen días después y se ordenan por texto.
//
// Ojo: todo se lee de process.env en el momento de loguear, no al importar.
// En ESM los imports se evalúan antes del dotenv.config() de server.ts, así que
// leerlo arriba nos daría siempre undefined.

const NIVELES = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;

export type Nivel = keyof typeof NIVELES;
type NivelImprimible = Exclude<Nivel, "silent">;

const COLORES = {
  gris: "\x1b[90m",
  rojo: "\x1b[31m",
  amarillo: "\x1b[33m",
  verde: "\x1b[32m",
  azul: "\x1b[34m",
  cyan: "\x1b[36m",
  negrita: "\x1b[1m",
  reset: "\x1b[0m",
} as const;

export type Color = keyof typeof COLORES;

export const esProduccion = (): boolean => process.env.NODE_ENV === "production";

// Sin colores si la salida no es una terminal (por ejemplo cuando run.sh
// redirige a .run.log) para no ensuciar el archivo con códigos ANSI.
const usarColor = (): boolean => Boolean(process.stdout.isTTY) && !esProduccion();

export function pintar(texto: unknown, color: Color): string {
  return usarColor() ? `${COLORES[color]}${String(texto)}${COLORES.reset}` : String(texto);
}

function nivelActual(): number {
  const configurado = String(process.env.LOG_LEVEL ?? "").toLowerCase();
  if (configurado in NIVELES) return NIVELES[configurado as Nivel];
  return esProduccion() ? NIVELES.info : NIVELES.debug;
}

export const habilitado = (nivel: Nivel): boolean => NIVELES[nivel] >= nivelActual();

// En producción, ISO en UTC: trae la fecha, se ordena como texto y no depende
// de la zona horaria que tenga el server del hosting.
function marcaDeTiempo(): string {
  const ahora = new Date();
  if (esProduccion()) return ahora.toISOString();
  return (
    ahora.toLocaleTimeString("es-AR", { hour12: false }) +
    "." +
    String(ahora.getMilliseconds()).padStart(3, "0")
  );
}

const ETIQUETAS: Record<
  NivelImprimible,
  { texto: string; color: Color; salida: (...args: unknown[]) => void }
> = {
  debug: { texto: "DEBUG", color: "gris", salida: console.debug },
  info: { texto: "INFO ", color: "cyan", salida: console.log },
  warn: { texto: "WARN ", color: "amarillo", salida: console.warn },
  error: { texto: "ERROR", color: "rojo", salida: console.error },
};

function escribir(nivel: NivelImprimible, args: unknown[]): void {
  if (!habilitado(nivel)) return;
  const { texto, color, salida } = ETIQUETAS[nivel];
  salida(`${pintar(marcaDeTiempo(), "gris")} ${pintar(texto, color)}`, ...args);
}

// Claves cuyo valor nunca queremos ver impreso en la consola.
const CLAVES_SENSIBLES = /password|token|secret|authorization|jwt/i;

// Devuelve una copia del objeto con los valores sensibles reemplazados.
// Sirve para loguear req.body sin filtrar contraseñas.
export function sanitizar(valor: unknown, profundidad = 0): unknown {
  if (valor === null || typeof valor !== "object" || profundidad > 4) return valor;
  if (Array.isArray(valor)) return valor.map((v) => sanitizar(v, profundidad + 1));

  const salida: Record<string, unknown> = {};
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = CLAVES_SENSIBLES.test(clave) ? "***" : sanitizar(v, profundidad + 1);
  }
  return salida;
}

// En producción el email sale enmascarado ("a***@tienda.com"): los logs del
// hosting los lee más gente y quedan guardados. En desarrollo va entero,
// porque es lo que se usa para seguir una prueba.
export function enmascararEmail(email: string): string {
  if (!esProduccion()) return email;
  const arroba = email.lastIndexOf("@");
  if (arroba < 0) return "***";
  return `${email.slice(0, 1)}***@${email.slice(arroba + 1)}`;
}

// Saca de un texto libre lo que puede identificar a alguien o abrir una
// sesión. Lo usa POST /app/errores (K12) antes de guardar lo que manda la app:
// un mensaje de error puede traer el email tipeado, un DNI o un token.
// El orden importa: primero los tokens (un JWT tiene puntos y un hex largo
// tiene dígitos), después emails y al final los números largos.
export function redactar(texto: string): string {
  return texto
    .replace(/Bearer\s+[\w.~+\/=-]+/gi, "Bearer [token]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[token]")
    // Hex de 32 o más: cubre el token de reseteo de contraseña.
    .replace(/\b[0-9a-f]{32,}\b/gi, "[token]")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    // DNI y teléfonos. La posición de un stack (":línea:columna") queda
    // intacta: en un bundle de Hermes minificado todo está en la línea 1 y la
    // columna pasa de 7 dígitos (index.android.bundle:1:1234567). Si se
    // redactara se perdería dónde pasó, y errores de lugares distintos del
    // bundle caerían en la misma huella de /app/errores.
    .replace(/(:\d+:\d+)|\d{7,}/g, (_coincidencia, posicion: string | undefined) =>
      posicion ?? "[numero]"
    );
}

// Formatea un Error para imprimirlo completo: nombre, mensaje y stack.
export function formatearError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const lineas = [`${error.name}: ${error.message}`];

  if (error.stack) {
    // Descartamos la primera línea del stack, que repite name + message.
    const stack = error.stack
      .split("\n")
      .slice(1)
      .filter((l) => !l.includes("node_modules") && !l.includes("node:internal"));
    lineas.push(...stack.map((l) => pintar(l.trimEnd(), "gris")));
  }

  // Errores encadenados (error.cause), si los hay.
  if (error.cause) lineas.push(pintar(`  causado por → ${formatearError(error.cause)}`, "gris"));

  return lineas.join("\n");
}

export const logger = {
  debug: (...args: unknown[]): void => escribir("debug", args),
  info: (...args: unknown[]): void => escribir("info", args),
  warn: (...args: unknown[]): void => escribir("warn", args),

  // Acepta tanto strings como Errors: si le pasás un Error imprime el stack.
  error: (...args: unknown[]): void =>
    escribir(
      "error",
      args.map((a) => (a instanceof Error ? formatearError(a) : a))
    ),

  success: (...args: unknown[]): void => escribir("info", [pintar("✔", "verde"), ...args]),
};

export default logger;
