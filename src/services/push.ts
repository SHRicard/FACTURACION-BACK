/**
 * Cliente del servicio de notificaciones push de Expo.
 *
 * Expo hace de intermediario con Google (FCM) y Apple (APNs): el back le
 * manda el token de cada teléfono y el texto, y Expo se encarga del resto.
 * Es gratis y no pide claves de Firebase en el back: las credenciales de
 * Google y Apple se cargan una vez en el proyecto de EAS (ver
 * doc/NOTIFICACIONES.md).
 *
 * Dos pasos, como lo pide Expo:
 *   1. enviarPush  → un "ticket" por notificación: Expo la aceptó o no.
 *   2. leerRecibos → unos 15 minutos después, si Google/Apple la entregó.
 *
 * EXPO_ACCESS_TOKEN solo hace falta si en expo.dev se activó "Enhanced
 * security for push notifications". Se lee en cada llamada, nunca al
 * importar (ver utils/logger.ts).
 */

const URL_ENVIO = "https://exp.host/--/api/v2/push/send";
const URL_RECIBOS = "https://exp.host/--/api/v2/push/getReceipts";

/** Topes de Expo: 100 notificaciones por pedido y 1000 recibos por consulta. */
export const MAXIMO_POR_ENVIO = 100;
export const MAXIMO_RECIBOS = 1000;

export interface MensajePush {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default";
  priority?: "default" | "normal" | "high";
  /** Android: el canal por el que se muestra. Tiene que existir en el teléfono. */
  channelId?: string;
}

export type TicketPush =
  | { status: "ok"; id: string }
  | { status: "error"; message: string; details?: { error?: string } };

export type ReciboExpo = { status: "ok" } | { status: "error"; message: string; details?: { error?: string } };

/** Un pedido que Expo rechazó entero (no una notificación suelta). */
export class ErrorExpo extends Error {
  constructor(
    mensaje: string,
    readonly status?: number,
    readonly codigo?: string,
    readonly detalles?: unknown
  ) {
    super(mensaje);
    this.name = "ErrorExpo";
  }
}

const esperar = (ms: number) => new Promise<void>((resolver) => setTimeout(resolver, ms));

/** Si Expo está saturado (429), caído (5xx) o se cortó la red: tres intentos más. */
const ESPERAS_REINTENTO = [1_000, 3_000, 9_000];

async function llamarExpo<T>(url: string, cuerpo: unknown): Promise<T> {
  const token = process.env["EXPO_ACCESS_TOKEN"]?.trim();
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
  };

  for (let intento = 0; ; intento++) {
    const espera = ESPERAS_REINTENTO[intento];
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (espera !== undefined) {
        await esperar(espera);
        continue;
      }
      throw new ErrorExpo(`Expo no responde: ${error instanceof Error ? error.message : String(error)}`);
    }

    if ((res.status === 429 || res.status >= 500) && espera !== undefined) {
      await esperar(espera);
      continue;
    }

    const json = (await res.json().catch(() => null)) as {
      data?: T;
      errors?: { code?: string; message?: string; details?: unknown }[];
    } | null;

    const [primero] = json?.errors ?? [];
    if (!res.ok || !json || primero || json.data === undefined) {
      throw new ErrorExpo(primero?.message ?? `Expo respondió ${res.status}`, res.status, primero?.code, primero?.details);
    }
    return json.data;
  }
}

/** { "@dueño/proyecto": [tokens] }: lo que manda Expo con PUSH_TOO_MANY_EXPERIENCE_IDS. */
const esTokensPorProyecto = (valor: unknown): valor is Record<string, string[]> =>
  typeof valor === "object" &&
  valor !== null &&
  Object.values(valor).every((tokens) => Array.isArray(tokens) && tokens.every((t) => typeof t === "string"));

async function enviarLote(lote: MensajePush[]): Promise<TicketPush[]> {
  try {
    const tickets = await llamarExpo<TicketPush[]>(URL_ENVIO, lote);
    if (tickets.length !== lote.length) {
      throw new ErrorExpo(`Expo devolvió ${tickets.length} tickets para ${lote.length} notificaciones`);
    }
    return tickets;
  } catch (error) {
    // Tokens de dos proyectos de Expo en el mismo pedido (por ejemplo, una
    // build de prueba de otro proyecto): Expo rechaza el pedido entero y dice
    // qué tokens son de cada uno. Se manda una parte por proyecto.
    if (
      !(error instanceof ErrorExpo) ||
      error.codigo !== "PUSH_TOO_MANY_EXPERIENCE_IDS" ||
      !esTokensPorProyecto(error.detalles)
    ) {
      throw error;
    }

    const porToken = new Map<string, TicketPush>();
    for (const tokens of Object.values(error.detalles)) {
      const parte = lote.filter((m) => tokens.includes(m.to));
      if (parte.length === 0) continue;
      const tickets = await llamarExpo<TicketPush[]>(URL_ENVIO, parte);
      parte.forEach((m, i) => {
        const ticket = tickets[i];
        if (ticket) porToken.set(m.to, ticket);
      });
    }
    return lote.map(
      (m) => porToken.get(m.to) ?? { status: "error", message: "Expo no respondió por este token", details: { error: "SinRespuesta" } }
    );
  }
}

/**
 * Manda las notificaciones y devuelve un ticket por cada una, en el mismo
 * orden. Un ticket con error es un teléfono que no la va a recibir (el pedido
 * sigue); un ErrorExpo es que no se pudo mandar nada de ese lote.
 */
export async function enviarPush(mensajes: MensajePush[]): Promise<TicketPush[]> {
  const tickets: TicketPush[] = [];
  for (let i = 0; i < mensajes.length; i += MAXIMO_POR_ENVIO) {
    tickets.push(...(await enviarLote(mensajes.slice(i, i + MAXIMO_POR_ENVIO))));
  }
  return tickets;
}

/**
 * Los recibos de esos tickets. Un id que no viene es que Expo todavía no lo
 * tiene (se consulta de nuevo más tarde) o que ya pasaron 24 horas.
 */
export async function leerRecibos(ids: string[]): Promise<Record<string, ReciboExpo>> {
  const recibos: Record<string, ReciboExpo> = {};
  for (let i = 0; i < ids.length; i += MAXIMO_RECIBOS) {
    Object.assign(recibos, await llamarExpo<Record<string, ReciboExpo>>(URL_RECIBOS, { ids: ids.slice(i, i + MAXIMO_RECIBOS) }));
  }
  return recibos;
}
