// Logger con niveles y colores, pensado para ver qué pasa mientras desarrollamos.
//
// El nivel se controla con LOG_LEVEL: debug | info | warn | error | silent
// Si no está seteado: "debug" en desarrollo, "info" con NODE_ENV=production.
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

function hora(): string {
  const ahora = new Date();
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
  salida(`${pintar(hora(), "gris")} ${pintar(texto, color)}`, ...args);
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
