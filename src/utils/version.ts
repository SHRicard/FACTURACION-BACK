// Versión mínima de la app (K8).
//
// El back se actualiza al instante; la app de Play, cuando cada persona quiere.
// Si un cambio del back deja de ser compatible con versiones viejas de la app,
// se sube APP_VERSION_MINIMA y esas versiones reciben 426 con el link a la
// tienda en vez de romperse de formas raras.
//
// Todo se lee de process.env en cada llamada, nunca al importar: en ESM los
// imports se evalúan antes del dotenv de server.ts (ver utils/logger.ts).

/** Package real de la app en Play (FRONT/app.json → android.package). */
export const URL_TIENDA_POR_DEFECTO =
  "https://play.google.com/store/apps/details?id=io.rrdev.facturacion";

/** 'mayor.menor.parche', tolerando sufijos como '-beta' o '+build'. */
function partesDeVersion(v: string): [number, number, number] | null {
  const partes = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  if (!partes) return null;
  return [Number(partes[1]), Number(partes[2]), Number(partes[3])];
}

export const esVersionValida = (v: string): boolean => partesDeVersion(v) !== null;

/**
 * -1 si a < b, 0 si son iguales, 1 si a > b. Compara por segmentos, así
 * '1.10.0' es mayor que '1.9.9'. null si alguna no parsea: el que llama decide
 * (el middleware de versión no bloquea lo que no entiende).
 */
export function compararVersiones(a: string, b: string): -1 | 0 | 1 | null {
  const pa = partesDeVersion(a);
  const pb = partesDeVersion(b);
  if (!pa || !pb) return null;

  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

export function urlTienda(): string {
  return process.env["APP_URL_TIENDA"]?.trim() || URL_TIENDA_POR_DEFECTO;
}

/** Lo que responde GET /app/version. */
export function configVersion(): { minima: string; ultima: string | null; urlTienda: string } {
  const minima = process.env["APP_VERSION_MINIMA"]?.trim() ?? "";
  const ultima = process.env["APP_VERSION_ULTIMA"]?.trim() ?? "";

  return {
    // '0.0.0' nunca bloquea: es el valor sin configurar.
    minima: esVersionValida(minima) ? minima : "0.0.0",
    ultima: esVersionValida(ultima) ? ultima : null,
    urlTienda: urlTienda(),
  };
}
