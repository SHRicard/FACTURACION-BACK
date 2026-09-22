import { createHash } from "node:crypto";
import { Router } from "express";
import ErrorCliente, { PLATAFORMAS_CLIENTE, type PlataformaCliente } from "../models/ErrorCliente.js";
import { autenticacionOpcional } from "../middleware/auth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { errorDeCampo } from "../utils/AppError.js";
import { logger, redactar } from "../utils/logger.js";
import { configVersion } from "../utils/version.js";

// Rutas que usa la app para hablar de sí misma, no del negocio: qué versión
// mínima hace falta (K8) y el reporte de sus errores (K12). Son públicas y el
// chequeo de versión no las bloquea: una app vieja tiene que poder enterarse
// de que está vieja y reportar por qué se rompió.

const router = Router();

// ───────────────────────── Versión ─────────────────────────
// GET /app/version → { minima, ultima, urlTienda }
// Con caché de 5 minutos: lo pide cada arranque de la app y cambia muy rara vez.
router.get("/version", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300").json(configVersion());
});

// ───────────────────────── Errores de la app ─────────────────────────

const esPlataforma = (valor: unknown): valor is PlataformaCliente =>
  typeof valor === "string" && (PLATAFORMAS_CLIENTE as readonly string[]).includes(valor);

/**
 * Un campo de texto del reporte. Vacío cuenta como que no vino. Lo que se
 * pasa de largo se rechaza con 400 en vez de recortarse, como dice K12: el
 * front tiene que recortar a estos máximos antes de mandar.
 */
function texto(valor: unknown, campo: string, max: number, requerido: true): string;
function texto(valor: unknown, campo: string, max: number, requerido?: false): string | undefined;
function texto(valor: unknown, campo: string, max: number, requerido = false): string | undefined {
  if (valor === undefined || valor === null || valor === "") {
    if (requerido) throw errorDeCampo(campo, `Falta el campo "${campo}"`);
    return undefined;
  }
  if (typeof valor !== "string") throw errorDeCampo(campo, `"${campo}" tiene que ser texto`);
  if (requerido && !valor.trim()) throw errorDeCampo(campo, `Falta el campo "${campo}"`);
  if (valor.length > max) {
    throw errorDeCampo(campo, `"${campo}" puede tener hasta ${max} caracteres`);
  }
  return valor;
}

/**
 * La línea del stack que identifica DÓNDE pasó: la primera que empieza con
 * "at " (la del frame), no la primera del todo, que repite el mensaje.
 */
function primerFrame(stack: string | undefined): string {
  if (!stack) return "";
  const lineas = stack.split("\n").map((l) => l.trim());
  return lineas.find((l) => l.startsWith("at ")) ?? lineas[0] ?? "";
}

// POST /app/errores — la app reporta un error de render o un error JS fatal.
//
// Público: si viene un token válido se asocia al usuario, y si viene uno roto
// se ignora (nunca 401). Nunca se guarda el email, el token, el body de las
// requests ni la IP; lo que es texto libre pasa por redactar() antes.
router.post(
  "/errores",
  rateLimit({ nombre: "errores-cliente", maximo: 20, ventanaMs: 15 * 60 * 1000 }),
  autenticacionOpcional,
  asyncHandler(async (req, res) => {
    const cuerpo: Record<string, unknown> =
      typeof req.body === "object" && req.body !== null ? req.body : {};

    const mensajeCrudo = texto(cuerpo["mensaje"], "mensaje", 500, true);
    const nombre = texto(cuerpo["nombre"], "nombre", 100);
    const stackCrudo = texto(cuerpo["stack"], "stack", 8000);
    const componentStackCrudo = texto(cuerpo["componentStack"], "componentStack", 4000);
    const rutaCruda = texto(cuerpo["ruta"], "ruta", 200);
    const version = texto(cuerpo["version"], "version", 20) ?? "desconocida";
    const versionSO = texto(cuerpo["versionSO"], "versionSO", 40);
    const dispositivo = texto(cuerpo["dispositivo"], "dispositivo", 80);

    const plataforma = cuerpo["plataforma"];
    if (!esPlataforma(plataforma)) {
      throw errorDeCampo(
        "plataforma",
        `"plataforma" tiene que ser una de: ${PLATAFORMAS_CLIENTE.join(", ")}`
      );
    }

    const fatal = cuerpo["fatal"] === true;

    // La fecha del teléfono puede venir rota; en ese caso vale la de llegada.
    const fechaCruda = cuerpo["ocurridoEn"];
    const fecha =
      typeof fechaCruda === "string" || typeof fechaCruda === "number"
        ? new Date(fechaCruda)
        : new Date(Number.NaN);
    const ocurridoEn = Number.isNaN(fecha.getTime()) ? new Date() : fecha;

    // Redactado antes de guardar y antes de la huella: así el mismo error con
    // dos emails distintos en el mensaje cae en el mismo grupo.
    const mensaje = redactar(mensajeCrudo);
    const stack = stackCrudo === undefined ? undefined : redactar(stackCrudo);
    const componentStack =
      componentStackCrudo === undefined ? undefined : redactar(componentStackCrudo);
    const ruta = rutaCruda === undefined ? undefined : redactar(rutaCruda);

    const huella = createHash("sha256")
      .update(`${nombre ?? ""}|${mensaje}|${primerFrame(stack)}`)
      .digest("hex");

    await ErrorCliente.create({
      mensaje,
      nombre,
      stack,
      componentStack,
      ruta,
      fatal,
      version,
      plataforma,
      versionSO,
      dispositivo,
      ocurridoEn,
      huella,
      usuario: req.usuario?._id,
      marca: req.usuario?.marca ?? undefined,
    });

    logger.warn(
      `[cliente] v${version} ${plataforma}${fatal ? " fatal" : ""} ${nombre ?? "Error"}: ${mensaje} (huella ${huella.slice(0, 6)})`
    );

    res.status(202).json({ recibido: true });
  })
);

export default router;
