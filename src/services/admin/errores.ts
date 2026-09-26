import ErrorCliente, { PLATAFORMAS_CLIENTE } from "../../models/ErrorCliente.js";
import { errorDeCampo, noEncontrado } from "../../utils/AppError.js";
import {
  leerEntero,
  leerOpcion,
  leerPaginacion,
  leerTexto,
  respuestaPaginada,
  saltear,
  type Query,
} from "../../utils/consulta.js";
import { escaparRegex } from "../../utils/validaciones.js";
import { logger } from "../../utils/logger.js";
import { haceDias } from "./comun.js";

/**
 * Los errores que reporta la app (POST /app/errores, K12), vistos por el
 * super_admin. Se agrupan por `huella`: el mismo error en cien teléfonos es
 * un renglón con cantidad 100, no cien renglones.
 *
 * Mongo los borra solos a los 30 días (índice TTL), así que ese es el máximo
 * que se puede mirar para atrás.
 */

const DIAS_MAXIMOS = 30;
const ORDENES_ERRORES = ["recientes", "frecuentes"] as const;

function filtroErrores(query: Query) {
  const dias = leerEntero(query, "dias", { defecto: 7, min: 1, max: DIAS_MAXIMOS });
  const plataforma = leerOpcion(query, "plataforma", PLATAFORMAS_CLIENTE);
  const version = leerTexto(query, "version");
  const buscar = leerTexto(query, "buscar");

  const fatalCrudo = query["fatal"];
  if (fatalCrudo !== undefined && fatalCrudo !== "" && fatalCrudo !== "true" && fatalCrudo !== "false") {
    throw errorDeCampo("fatal", '"fatal" tiene que ser true o false');
  }

  const filtro: Record<string, unknown> = { createdAt: { $gte: haceDias(dias) } };
  if (plataforma) filtro["plataforma"] = plataforma;
  if (version) filtro["version"] = version;
  if (fatalCrudo === "true") filtro["fatal"] = true;
  if (fatalCrudo === "false") filtro["fatal"] = { $ne: true };
  if (buscar) {
    const patron = new RegExp(escaparRegex(buscar), "i");
    filtro["$or"] = [{ mensaje: patron }, { nombre: patron }, { ruta: patron }];
  }
  return { filtro, dias };
}

/** Lo que resume un grupo, igual en el listado y en el detalle. */
const RESUMEN_GRUPO = {
  nombre: { $last: "$nombre" },
  mensaje: { $last: "$mensaje" },
  ruta: { $last: "$ruta" },
  cantidad: { $sum: 1 },
  fatales: { $sum: { $cond: ["$fatal", 1, 0] } },
  usuarios: { $addToSet: "$usuario" },
  marcas: { $addToSet: "$marca" },
  versiones: { $addToSet: "$version" },
  plataformas: { $addToSet: "$plataforma" },
  primeraVez: { $min: "$createdAt" },
  ultimaVez: { $max: "$createdAt" },
};

/** Los sets se devuelven como cantidades: nadie necesita la lista de ids. */
const PROYECCION_GRUPO = {
  _id: 0,
  huella: "$_id",
  nombre: 1,
  mensaje: 1,
  ruta: 1,
  cantidad: 1,
  fatales: 1,
  usuariosAfectados: { $size: { $setDifference: ["$usuarios", [null]] } },
  marcasAfectadas: { $size: { $setDifference: ["$marcas", [null]] } },
  versiones: 1,
  plataformas: 1,
  primeraVez: 1,
  ultimaVez: 1,
};

/**
 * GET /admin/errores
 *
 * Query: dias (1-30, por defecto 7), plataforma, version, fatal, buscar,
 * orden (recientes | frecuentes), pagina, porPagina.
 */
export async function listarErrores(query: Query) {
  const paginacion = leerPaginacion(query);
  const orden = leerOpcion(query, "orden", ORDENES_ERRORES, "recientes");
  const { filtro, dias } = filtroErrores(query);

  const [resultado] = await ErrorCliente.aggregate<{
    datos: Record<string, unknown>[];
    total: { n: number }[];
    ocurrencias: { n: number }[];
  }>([
    { $match: filtro },
    { $sort: { createdAt: 1 } },
    { $group: { _id: "$huella", ...RESUMEN_GRUPO } },
    { $project: PROYECCION_GRUPO },
    {
      $facet: {
        datos: [
          { $sort: orden === "frecuentes" ? { cantidad: -1, ultimaVez: -1 } : { ultimaVez: -1 } },
          { $skip: saltear(paginacion) },
          { $limit: paginacion.porPagina },
        ],
        total: [{ $count: "n" }],
        ocurrencias: [{ $group: { _id: null, n: { $sum: "$cantidad" } } }],
      },
    },
  ]);

  return {
    dias,
    ocurrencias: resultado?.ocurrencias[0]?.n ?? 0,
    ...respuestaPaginada(resultado?.datos ?? [], resultado?.total[0]?.n ?? 0, paginacion),
  };
}

/**
 * GET /admin/errores/:huella — el grupo y cada vez que pasó, con el stack
 * completo y quién lo sufrió. Mismos filtros que el listado.
 */
export async function detalleError(huella: string, query: Query) {
  const paginacion = leerPaginacion(query);
  const { filtro, dias } = filtroErrores(query);
  const delGrupo = { ...filtro, huella };

  const [[grupo], ocurrencias, total] = await Promise.all([
    ErrorCliente.aggregate<Record<string, unknown>>([
      { $match: delGrupo },
      { $sort: { createdAt: 1 } },
      { $group: { _id: "$huella", ...RESUMEN_GRUPO } },
      { $project: PROYECCION_GRUPO },
    ]),
    ErrorCliente.find(delGrupo)
      .populate({ path: "usuario", select: "nombre email" })
      .populate({ path: "marca", select: "nombre" })
      .sort({ createdAt: -1 })
      .skip(saltear(paginacion))
      .limit(paginacion.porPagina),
    ErrorCliente.countDocuments(delGrupo),
  ]);

  if (!grupo) throw noEncontrado("Error");
  return { dias, grupo, ocurrencias: respuestaPaginada(ocurrencias, total, paginacion) };
}

/**
 * DELETE /admin/errores/:huella — "ya lo arreglé": borra todas las veces que
 * pasó. Si vuelve a pasar, aparece de nuevo como un grupo nuevo.
 */
export async function borrarError(huella: string) {
  const { deletedCount } = await ErrorCliente.deleteMany({ huella });
  if (deletedCount === 0) throw noEncontrado("Error");
  logger.info(`[admin] error ${huella.slice(0, 6)} marcado como resuelto (${deletedCount} reportes)`);
  return { mensaje: "Error marcado como resuelto", borrados: deletedCount };
}
