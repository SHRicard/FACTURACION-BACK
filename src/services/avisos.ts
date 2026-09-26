import { createHash } from "node:crypto";
import type { Types } from "mongoose";
import Aviso, { LARGO_MAXIMO_AVISO, TIPOS_AVISO, type AvisoDocument, type TipoAviso } from "../models/Aviso.js";
import Dispositivo, { PLATAFORMAS_DISPOSITIVO, TOKEN_EXPO } from "../models/Dispositivo.js";
import ReciboPush from "../models/ReciboPush.js";
import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import { enviarPush, leerRecibos, type MensajePush, type TicketPush } from "./push.js";
import { AppError, errorDeCampo, noEncontrado } from "../utils/AppError.js";
import { leerPaginacion, respuestaPaginada, saltear, type Query } from "../utils/consulta.js";
import { urlTienda } from "../utils/version.js";
import { logger } from "../utils/logger.js";
import { exigirId, haceDias } from "./admin/comun.js";

/**
 * Los avisos del super_admin a todos los que tienen la app instalada (un
 * mantenimiento, una funcionalidad nueva, una versión nueva) y los teléfonos
 * que los reciben.
 *
 *   POST /app/dispositivos  la app registra su token de Expo al abrir
 *   POST /admin/avisos      el super_admin escribe el aviso: responde al
 *                           instante y el envío sigue en segundo plano
 *   cada 5 minutos          se piden los recibos a Expo: cuántos llegaron, y
 *                           se borran los teléfonos que desinstalaron la app
 *
 * El envío en segundo plano y el control de repetidos viven en memoria: igual
 * que el rate limit, suponen UNA sola instancia del server.
 */

// ─────────────────────────────────────────────────────────────
// Teléfonos

/**
 * POST /app/dispositivos   { token, plataforma? }
 *
 * La app lo llama al abrir, al iniciar sesión y al cerrarla. Con sesión, el
 * teléfono queda asociado a esa cuenta; sin sesión, queda anónimo, pero igual
 * recibe los avisos: son para todo el que tenga la app.
 *
 * La plataforma, si no viene en el body, sale del header X-App-Plataforma que
 * la app ya manda en cada pedido.
 */
export async function registrarDispositivo(
  body: Record<string, unknown> | undefined,
  usuario: UsuarioDocument | undefined,
  headers: { version?: string | undefined; plataforma?: string | undefined }
): Promise<{ registrado: true }> {
  const token = typeof body?.["token"] === "string" ? body["token"].trim() : "";
  if (!TOKEN_EXPO.test(token)) {
    throw errorDeCampo("token", "El token de notificaciones no es válido: tiene que ser el que da getExpoPushTokenAsync()");
  }
  const plataforma = body?.["plataforma"] ?? headers.plataforma;
  const version = headers.version;
  if (!PLATAFORMAS_DISPOSITIVO.some((p) => p === plataforma)) {
    throw errorDeCampo("plataforma", `"plataforma" tiene que ser una de: ${PLATAFORMAS_DISPOSITIVO.join(", ")}`);
  }

  const actualizar = {
    $set: {
      plataforma,
      ultimoUso: new Date(),
      ...(version && { version: version.slice(0, 20) }),
      ...(usuario && { usuario: usuario._id }),
    },
    ...(!usuario && { $unset: { usuario: "" } }),
  };

  try {
    await Dispositivo.updateOne({ token }, actualizar, { upsert: true, runValidators: true });
  } catch (error) {
    // Dos registros del mismo teléfono a la vez: el segundo upsert choca con
    // el índice único. Para entonces el documento ya existe: se actualiza.
    if ((error as { code?: unknown }).code !== 11000) throw error;
    await Dispositivo.updateOne({ token }, actualizar, { runValidators: true });
  }
  return { registrado: true };
}

/** Las cuentas suspendidas no reciben avisos: no pueden usar la app. */
const idsSuspendidos = (): Promise<Types.ObjectId[]> => Usuario.find({ suspendida: true }).distinct("_id");

/**
 * GET /admin/avisos/alcance — a cuántos teléfonos le llegaría un aviso
 * ahora. Para mostrarlo antes de confirmar el envío.
 */
export async function alcanceAvisos() {
  const suspendidos = await idsSuspendidos();
  const destinatarios = { usuario: { $nin: suspendidos } };
  const conCuenta = { usuario: { $nin: suspendidos, $ne: null } };

  const [porPlataforma, conSesion, cuentas, activos30d] = await Promise.all([
    Dispositivo.aggregate<{ _id: string; n: number }>([
      { $match: destinatarios },
      { $group: { _id: "$plataforma", n: { $sum: 1 } } },
    ]),
    Dispositivo.countDocuments(conCuenta),
    Dispositivo.distinct("usuario", conCuenta),
    Dispositivo.countDocuments({ ...destinatarios, ultimoUso: { $gte: haceDias(30) } }),
  ]);

  const plataformas = Object.fromEntries(porPlataforma.map(({ _id, n }) => [_id, n]));
  const dispositivos = porPlataforma.reduce((t, { n }) => t + n, 0);
  return {
    dispositivos,
    porPlataforma: { android: plataformas["android"] ?? 0, ios: plataformas["ios"] ?? 0 },
    conSesion,
    sinSesion: dispositivos - conSesion,
    cuentas: cuentas.length,
    activos30d,
  };
}

// ─────────────────────────────────────────────────────────────
// La notificación

type DatosAviso = { titulo: string; mensaje: string; tipo: TipoAviso };

function leerTexto(valor: unknown, campo: "titulo" | "mensaje"): string {
  const nombre = campo === "titulo" ? "el título" : "el mensaje";
  if (typeof valor !== "string" || !valor.trim()) throw errorDeCampo(campo, `Escribí ${nombre} del aviso`);
  const limpio = valor.trim();
  const maximo = LARGO_MAXIMO_AVISO[campo];
  if (limpio.length > maximo) {
    throw errorDeCampo(campo, `${nombre === "el título" ? "El título" : "El mensaje"} puede tener hasta ${maximo} caracteres`);
  }
  return limpio;
}

function leerAviso(body: Record<string, unknown> | undefined): DatosAviso {
  const tipoCrudo = body?.["tipo"];
  if (tipoCrudo !== undefined && tipoCrudo !== null && tipoCrudo !== "" && !TIPOS_AVISO.some((t) => t === tipoCrudo)) {
    throw errorDeCampo("tipo", `"tipo" tiene que ser uno de: ${TIPOS_AVISO.join(", ")}`);
  }
  return {
    titulo: leerTexto(body?.["titulo"], "titulo"),
    mensaje: leerTexto(body?.["mensaje"], "mensaje"),
    tipo: (TIPOS_AVISO.find((t) => t === tipoCrudo) ?? "aviso") as TipoAviso,
  };
}

/**
 * El canal de Android por el que salen los avisos. La app lo crea antes de
 * pedir el permiso (ver doc/NOTIFICACIONES.md): así la persona lo ve con
 * nombre propio en los ajustes del teléfono y lo puede silenciar aparte.
 */
export const CANAL_ANDROID = "avisos";

/**
 * Lo que recibe cada teléfono. En `data` va lo que la app necesita para
 * reaccionar al tocarla: abrir la lista de avisos, o la tienda si es una
 * versión nueva.
 */
function notificacion(aviso: DatosAviso & { _id?: Types.ObjectId }, token: string): MensajePush {
  return {
    to: token,
    title: aviso.titulo,
    body: aviso.mensaje,
    sound: "default",
    priority: "high",
    channelId: CANAL_ANDROID,
    data: {
      origen: "aviso",
      tipo: aviso.tipo,
      ...(aviso._id ? { avisoId: String(aviso._id) } : { prueba: true }),
      ...(aviso.tipo === "version" && { urlTienda: urlTienda() }),
    },
  };
}

/** Los códigos de Expo van como nombre de campo: solo letras, o "Otro". */
const codigoDeError = (codigo: unknown): string =>
  typeof codigo === "string" && /^[A-Za-z]{1,40}$/.test(codigo) ? codigo : "Otro";

/** Lo que dejaron los tickets de un lote: qué contar, qué recibos pedir, qué teléfonos borrar. */
function leerTickets(tickets: TicketPush[], tokens: string[]) {
  const aceptados: { ticket: string; token: string }[] = [];
  const muertos: string[] = [];
  const errores: Record<string, number> = {};

  tickets.forEach((ticket, i) => {
    const token = tokens[i]!;
    if (ticket.status === "ok") {
      aceptados.push({ ticket: ticket.id, token });
      return;
    }
    const codigo = codigoDeError(ticket.details?.error);
    errores[codigo] = (errores[codigo] ?? 0) + 1;
    if (codigo === "DeviceNotRegistered") muertos.push(token);
  });

  if (errores["InvalidCredentials"]) {
    logger.error(
      "Expo rechazó notificaciones por credenciales: faltan las de FCM (Android) o APNs (iOS) en el proyecto de EAS. Ver doc/NOTIFICACIONES.md"
    );
  }
  return { aceptados, muertos, errores, rechazados: tickets.length - aceptados.length };
}

const incrementosDeErrores = (errores: Record<string, number>) =>
  Object.fromEntries(Object.entries(errores).map(([codigo, n]) => [`envio.errores.${codigo}`, n]));

// ─────────────────────────────────────────────────────────────
// El envío, en segundo plano

const enCurso = new Map<string, Promise<void>>();
let deteniendo = false;

/**
 * Manda el aviso a todos los teléfonos, de a 100, en orden de _id. Después de
 * cada lote guarda el cursor: si el server se apaga a mitad de camino, al
 * arrancar sigue desde ahí (a lo sumo repite el último lote de 100).
 */
function procesarEnvio(avisoId: Types.ObjectId): Promise<void> {
  const clave = String(avisoId);
  const yaEnCurso = enCurso.get(clave);
  if (yaEnCurso) return yaEnCurso;

  const tarea = (async () => {
    const aviso = await Aviso.findById(avisoId);
    if (!aviso || aviso.estado !== "enviando") return;

    const suspendidos = await idsSuspendidos();
    let cursor = aviso.envio.cursor ?? null;

    try {
      for (;;) {
        // Apagado ordenado: queda "enviando" y se retoma al arrancar.
        if (deteniendo) return;

        const lote = await Dispositivo.find({
          usuario: { $nin: suspendidos },
          ...(cursor && { _id: { $gt: cursor } }),
        })
          .sort({ _id: 1 })
          .limit(100)
          .select("token");
        if (lote.length === 0) break;

        const tokens = lote.map((d) => d.token);
        const tickets = await enviarPush(tokens.map((token) => notificacion(aviso, token)));
        const { aceptados, muertos, errores, rechazados } = leerTickets(tickets, tokens);
        cursor = lote[lote.length - 1]!._id;

        await Promise.all([
          aceptados.length > 0 && ReciboPush.insertMany(aceptados.map((a) => ({ ...a, aviso: aviso._id }))),
          muertos.length > 0 && Dispositivo.deleteMany({ token: { $in: muertos } }),
          Aviso.updateOne(
            { _id: aviso._id },
            {
              $inc: { "envio.enviados": aceptados.length, "envio.rechazados": rechazados, ...incrementosDeErrores(errores) },
              $set: { "envio.cursor": cursor },
            }
          ),
        ]);
      }

      await Aviso.updateOne(
        { _id: aviso._id },
        { $set: { estado: "enviado", enviadoEl: new Date() }, $unset: { "envio.cursor": "", "envio.ultimoError": "" } }
      );
      logger.success(`Aviso "${aviso.titulo}" enviado`);
    } catch (error) {
      if (deteniendo) return;
      const mensaje = error instanceof Error ? error.message : String(error);
      logger.error(`No se pudo terminar de enviar el aviso "${aviso.titulo}": ${mensaje}`);
      await Aviso.updateOne({ _id: aviso._id }, { $set: { estado: "fallido", "envio.ultimoError": mensaje.slice(0, 300) } });
    }
  })()
    .catch((error: unknown) => logger.error(error))
    .finally(() => enCurso.delete(clave));

  enCurso.set(clave, tarea);
  return tarea;
}

// Mientras se crea un aviso, su huella está acá: frena el doble clic.
const creando = new Set<string>();
/** Un aviso igual dentro de este lapso se toma como repetido. */
const MINUTOS_REPETIDO = 10;

/**
 * POST /admin/avisos   { titulo, mensaje, tipo? }
 *
 * Lo guarda y responde enseguida (202): el envío sigue en segundo plano y el
 * panel ve el avance en GET /admin/avisos/:id. El mismo título y mensaje dos
 * veces en 10 minutos es un doble clic: 409 AVISO_REPETIDO.
 */
export async function crearAviso(body: Record<string, unknown> | undefined, autor: UsuarioDocument) {
  const datos = leerAviso(body);
  const huella = createHash("sha256").update(`${datos.titulo}|${datos.mensaje}`).digest("hex");
  if (creando.has(huella)) throw avisoRepetido();
  creando.add(huella);

  try {
    const repetido = await Aviso.findOne({
      titulo: datos.titulo,
      mensaje: datos.mensaje,
      createdAt: { $gte: new Date(Date.now() - MINUTOS_REPETIDO * 60_000) },
    }).select("_id");
    if (repetido) throw avisoRepetido(repetido._id);

    const suspendidos = await idsSuspendidos();
    const dispositivos = await Dispositivo.countDocuments({ usuario: { $nin: suspendidos } });
    const aviso = await Aviso.create({ ...datos, creadoPor: autor._id, envio: { dispositivos } });

    logger.info(`Aviso nuevo (${datos.tipo}) para ${dispositivos} teléfonos: "${datos.titulo}"`);
    void procesarEnvio(aviso._id);
    return aviso;
  } finally {
    creando.delete(huella);
  }
}

const avisoRepetido = (id?: Types.ObjectId) =>
  new AppError(
    `Ya mandaste este mismo aviso hace menos de ${MINUTOS_REPETIDO} minutos`,
    409,
    id ? { aviso: id } : undefined,
    "AVISO_REPETIDO"
  );

/**
 * POST /admin/avisos/prueba   { titulo, mensaje, tipo? }
 *
 * Lo manda solo a los teléfonos del super_admin, para ver cómo queda antes
 * de mandarlo a todos. No se guarda ni aparece en la lista de la app.
 */
export async function enviarPrueba(body: Record<string, unknown> | undefined, usuario: UsuarioDocument) {
  const datos = leerAviso(body);
  const dispositivos = await Dispositivo.find({ usuario: usuario._id }).select("token");
  if (dispositivos.length === 0) {
    throw new AppError(
      "No tenés ningún teléfono registrado para recibir notificaciones. Abrí la app con tu cuenta y aceptá las notificaciones.",
      409,
      undefined,
      "SIN_DISPOSITIVOS"
    );
  }

  const tokens = dispositivos.map((d) => d.token);
  const tickets = await enviarPush(tokens.map((token) => notificacion(datos, token)));
  const { aceptados, muertos, errores, rechazados } = leerTickets(tickets, tokens);
  if (muertos.length > 0) await Dispositivo.deleteMany({ token: { $in: muertos } });

  return { dispositivos: tokens.length, enviados: aceptados.length, rechazados, errores };
}

// ─────────────────────────────────────────────────────────────
// Recibos: si Google/Apple la entregó

let revisandoRecibos = false;
/** Expo tiene el recibo unos 15 minutos después del envío. */
const MINUTOS_HASTA_EL_RECIBO = 15;

/**
 * Pide a Expo los recibos de lo que se mandó hace más de 15 minutos, los suma
 * a cada aviso y borra los teléfonos que desinstalaron la app. Los que Expo
 * todavía no tiene se vuelven a pedir en la próxima vuelta; pasadas 24 horas
 * se dejan (Expo ya no los guarda) y quedan sin confirmar.
 */
export async function procesarRecibos(ahora = new Date()): Promise<{ revisados: number }> {
  if (revisandoRecibos) return { revisados: 0 };
  revisandoRecibos = true;

  try {
    const listos = new Date(ahora.getTime() - MINUTOS_HASTA_EL_RECIBO * 60_000);
    const vencidos = new Date(ahora.getTime() - 24 * 3600_000);
    let desde: Types.ObjectId | null = null;
    let revisados = 0;

    for (;;) {
      const lote = await ReciboPush.find({ createdAt: { $lt: listos }, ...(desde ? { _id: { $gt: desde } } : {}) })
        .sort({ _id: 1 })
        .limit(1000);
      if (lote.length === 0) break;
      desde = lote[lote.length - 1]!._id;

      const recibos = await leerRecibos(lote.map((r) => r.ticket));
      const porAviso = new Map<string, { entregados: number; fallidos: number; errores: Record<string, number> }>();
      const listosParaBorrar: Types.ObjectId[] = [];
      const muertos: string[] = [];

      for (const r of lote) {
        const recibo = recibos[r.ticket];
        if (!recibo) {
          if (r.createdAt < vencidos) listosParaBorrar.push(r._id);
          continue;
        }
        listosParaBorrar.push(r._id);

        const cuenta = porAviso.get(String(r.aviso)) ?? { entregados: 0, fallidos: 0, errores: {} };
        porAviso.set(String(r.aviso), cuenta);
        if (recibo.status === "ok") {
          cuenta.entregados++;
          continue;
        }
        cuenta.fallidos++;
        const codigo = codigoDeError(recibo.details?.error);
        cuenta.errores[codigo] = (cuenta.errores[codigo] ?? 0) + 1;
        if (codigo === "DeviceNotRegistered") muertos.push(r.token);
        if (codigo === "InvalidCredentials" || codigo === "MismatchSenderId") {
          logger.error(`Google/Apple rechazó una notificación (${codigo}): revisá las credenciales push del proyecto de EAS`);
        }
      }

      await Promise.all([
        porAviso.size > 0 &&
          Aviso.bulkWrite(
            [...porAviso].map(([id, c]) => ({
              updateOne: {
                filter: { _id: id },
                update: { $inc: { "envio.entregados": c.entregados, "envio.fallidos": c.fallidos, ...incrementosDeErrores(c.errores) } },
              },
            }))
          ),
        muertos.length > 0 && Dispositivo.deleteMany({ token: { $in: muertos } }),
        listosParaBorrar.length > 0 && ReciboPush.deleteMany({ _id: { $in: listosParaBorrar } }),
      ]);
      revisados += listosParaBorrar.length;
    }

    if (revisados > 0) logger.info(`Recibos de notificaciones revisados: ${revisados}`);
    return { revisados };
  } finally {
    revisandoRecibos = false;
  }
}

// ─────────────────────────────────────────────────────────────
// Arranque y apagado (los llama server.ts)

let intervaloRecibos: NodeJS.Timeout | null = null;

/**
 * Al arrancar: retoma los avisos que quedaron a mitad de envío (un deploy,
 * un reinicio) y deja programada la revisión de recibos cada 5 minutos.
 */
export async function iniciarAvisos(): Promise<void> {
  deteniendo = false;
  const pendientes = await Aviso.find({ estado: "enviando" }).select("_id titulo");
  if (pendientes.length > 0) {
    logger.info(`Retomo el envío de ${pendientes.length} aviso(s) que quedaron a mitad de camino`);
    void (async () => {
      for (const { _id } of pendientes) await procesarEnvio(_id);
    })();
  }

  intervaloRecibos = setInterval(() => {
    procesarRecibos().catch((error: unknown) => logger.error(error));
  }, 5 * 60_000);
  intervaloRecibos.unref();
}

/**
 * Al apagar: no arranca más lotes y espera (hasta 5 s) el que está en camino.
 * Lo que falte queda "enviando" y se retoma en el próximo arranque.
 */
export async function detenerAvisos(): Promise<void> {
  deteniendo = true;
  if (intervaloRecibos) clearInterval(intervaloRecibos);
  await Promise.race([Promise.allSettled([...enCurso.values()]), new Promise((r) => setTimeout(r, 5_000))]);
}

// ─────────────────────────────────────────────────────────────
// Consultas

/** GET /admin/avisos — el historial, los últimos primero. */
export async function listarAvisos(query: Query) {
  const paginacion = leerPaginacion(query);
  const [avisos, total] = await Promise.all([
    Aviso.find()
      .populate({ path: "creadoPor", select: "nombre email" })
      .sort({ createdAt: -1 })
      .skip(saltear(paginacion))
      .limit(paginacion.porPagina),
    Aviso.countDocuments(),
  ]);
  return respuestaPaginada(avisos, total, paginacion);
}

async function buscarAviso(id: unknown): Promise<AvisoDocument> {
  const aviso = await Aviso.findById(exigirId(id, "Aviso"));
  if (!aviso) throw noEncontrado("Aviso");
  return aviso;
}

/** GET /admin/avisos/:id — con cuántos recibos faltan confirmar. */
export async function detalleAviso(id: unknown) {
  const { _id } = await buscarAviso(id);
  const [aviso, sinConfirmar] = await Promise.all([
    Aviso.findById(_id).populate({ path: "creadoPor", select: "nombre email" }),
    ReciboPush.countDocuments({ aviso: _id }),
  ]);
  return { aviso, sinConfirmar };
}

/** POST /admin/avisos/:id/reintentar — sigue un envío fallido desde donde quedó. */
export async function reintentarAviso(id: unknown) {
  const aviso = await buscarAviso(id);
  if (aviso.estado !== "fallido") {
    throw new AppError(`Solo se reintenta un aviso fallido: este está ${aviso.estado}`, 409);
  }
  await Aviso.updateOne({ _id: aviso._id }, { $set: { estado: "enviando" }, $unset: { "envio.ultimoError": "" } });
  void procesarEnvio(aviso._id);
  return detalleAviso(aviso._id);
}

/**
 * DELETE /admin/avisos/:id — lo saca del historial y de la lista de la app.
 * La notificación que ya llegó a los teléfonos no se puede borrar.
 */
export async function borrarAviso(id: unknown) {
  const aviso = await buscarAviso(id);
  if (aviso.estado === "enviando") {
    throw new AppError("El aviso se está enviando: esperá a que termine para borrarlo", 409);
  }
  await Promise.all([aviso.deleteOne(), ReciboPush.deleteMany({ aviso: aviso._id })]);
  logger.info(`Aviso borrado: "${aviso.titulo}"`);
  return { mensaje: "Aviso borrado" };
}

/** Lo que muestra la app: los últimos 20 avisos de los últimos 90 días. */
const DIAS_EN_LA_APP = 90;

/**
 * GET /app/avisos — pública: le llega también al que abrió la notificación
 * sin haber iniciado sesión, y al que no tiene las notificaciones activadas.
 */
export async function avisosParaLaApp() {
  const avisos = await Aviso.find({ createdAt: { $gte: haceDias(DIAS_EN_LA_APP) } })
    .sort({ createdAt: -1 })
    .limit(20)
    .select("titulo mensaje tipo createdAt");

  return {
    datos: avisos.map((a) => ({
      _id: a._id,
      titulo: a.titulo,
      mensaje: a.mensaje,
      tipo: a.tipo,
      fecha: a.createdAt,
      ...(a.tipo === "version" && { urlTienda: urlTienda() }),
    })),
  };
}
