import Usuario, { PROVEEDORES, type UsuarioDocument } from "../../models/Usuario.js";
import Marca from "../../models/Marca.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import ErrorCliente from "../../models/ErrorCliente.js";
import { ROLES, esRol, ROL_POR_DEFECTO } from "../../config/roles.js";
import { pendienteDe } from "../../middleware/marca.js";
import { marcaConDuenos } from "../marcas.js";
import { eliminarCuenta } from "../eliminacionCuenta.js";
import { AppError, errorDeCampo, noEncontrado, prohibido } from "../../utils/AppError.js";
import {
  leerBooleano,
  leerOpcion,
  leerPaginacion,
  leerTexto,
  respuestaPaginada,
  saltear,
  type Query,
} from "../../utils/consulta.js";
import { EMAIL_VALIDO, escaparRegex, normalizarDni, patronDeTexto } from "../../utils/validaciones.js";
import { enmascararEmail, logger } from "../../utils/logger.js";
import { ESTADOS_ONBOARDING, exigirId, filtroOnboarding, haceDias } from "./comun.js";

/**
 * Las cuentas, vistas por el super_admin: listarlas, ver una en detalle y
 * las pocas cosas que puede hacer sobre ellas (crear, corregir, suspender,
 * cerrar sesiones, borrar).
 *
 * Nunca toca a otro super_admin ni a sí mismo: para eso no hay pantalla.
 */

const ORDENES_USUARIOS = ["recientes", "antiguos", "nombre", "ultimoAcceso"] as const;
const SORT_USUARIOS = {
  recientes: { createdAt: -1 },
  antiguos: { createdAt: 1 },
  nombre: { nombre: 1 },
  ultimoAcceso: { ultimoAcceso: -1 },
} as const;

const CAMPOS_MARCA_RESUMIDA = "nombre logoUrl";

/** El usuario como sale en los listados del super_admin: con su `pendiente`. */
const conPendiente = (usuario: UsuarioDocument) => ({
  ...usuario.toJSON(),
  pendiente: pendienteDe(usuario),
});

/**
 * GET /admin/usuarios
 *
 * Filtros: buscar (nombre, email o DNI), rol, proveedor, onboarding
 * (terminos | perfil | marca | listo), suspendida, activosDias (con acceso en
 * los últimos N días), inactivosDias (sin acceso hace N días o nunca).
 */
export async function listarUsuarios(query: Query) {
  const paginacion = leerPaginacion(query);
  const orden = leerOpcion(query, "orden", ORDENES_USUARIOS, "recientes");
  const rol = leerOpcion(query, "rol", ROLES);
  const proveedor = leerOpcion(query, "proveedor", PROVEEDORES);
  const onboarding = leerOpcion(query, "onboarding", ESTADOS_ONBOARDING);
  const buscar = leerTexto(query, "buscar");

  const filtros: Record<string, unknown>[] = [];
  if (rol) filtros.push({ rol });
  if (proveedor) filtros.push({ proveedor });
  if (onboarding) filtros.push(filtroOnboarding(onboarding));
  if (query["suspendida"] !== undefined && query["suspendida"] !== "") {
    filtros.push(leerBooleano(query, "suspendida") ? { suspendida: true } : { suspendida: { $ne: true } });
  }

  const activosDias = diasDeLaQuery(query, "activosDias");
  if (activosDias) filtros.push({ ultimoAcceso: { $gte: haceDias(activosDias) } });
  const inactivosDias = diasDeLaQuery(query, "inactivosDias");
  if (inactivosDias) {
    filtros.push({
      $or: [{ ultimoAcceso: null }, { ultimoAcceso: { $lt: haceDias(inactivosDias) } }],
    });
  }

  if (buscar) {
    const digitos = buscar.replace(/[\s.\-]/g, "");
    filtros.push({
      $or: [
        { nombre: patronDeTexto(buscar) },
        { email: new RegExp(escaparRegex(buscar.toLowerCase()), "i") },
        ...(/^\d+$/.test(digitos) ? [{ dni: new RegExp(`^${digitos}`) }] : []),
      ],
    });
  }

  const filtro = filtros.length ? { $and: filtros } : {};
  const [usuarios, total] = await Promise.all([
    Usuario.find(filtro)
      .populate({ path: "marca", select: CAMPOS_MARCA_RESUMIDA })
      .sort({ ...SORT_USUARIOS[orden], _id: -1 })
      .skip(saltear(paginacion))
      .limit(paginacion.porPagina),
    Usuario.countDocuments(filtro),
  ]);

  return respuestaPaginada(usuarios.map(conPendiente), total, paginacion);
}

function diasDeLaQuery(query: Query, campo: string): number | undefined {
  const valor = query[campo];
  if (valor === undefined || valor === "") return undefined;
  const dias = Number(valor);
  if (!Number.isInteger(dias) || dias < 1 || dias > 3650) {
    throw errorDeCampo(campo, `"${campo}" tiene que ser un número de días entre 1 y 3650`);
  }
  return dias;
}

async function buscarUsuario(id: unknown): Promise<UsuarioDocument> {
  const usuario = await Usuario.findById(exigirId(id, "Usuario"));
  if (!usuario) throw noEncontrado("Usuario");
  return usuario;
}

/**
 * Las acciones sobre una cuenta no aplican a un super_admin (ni al propio):
 * suspenderse o borrarse a uno mismo deja la plataforma sin nadie que la
 * administre.
 */
function exigirAdministrador(usuario: UsuarioDocument, yo: UsuarioDocument, accion: string): void {
  if (usuario._id.equals(yo._id)) throw prohibido(`No podés ${accion} tu propia cuenta`);
  if (usuario.rol === "super_admin") throw prohibido(`No se puede ${accion} a un super_admin`);
}

/**
 * GET /admin/usuarios/:id — la cuenta, su marca y lo que hizo.
 */
export async function detalleUsuario(id: unknown) {
  const usuario = await buscarUsuario(id);
  const desde30 = haceDias(30);

  const [marca, ticketsRegistrados, pagosRegistrados, ultimoTicket, ultimoPago, errores30d] =
    await Promise.all([
      usuario.marca ? marcaConDuenos(usuario.marca) : null,
      Ticket.countDocuments({ registradoPor: usuario._id, anulado: { $ne: true } }),
      Pago.countDocuments({ registradoPor: usuario._id, anulado: { $ne: true } }),
      Ticket.findOne({ registradoPor: usuario._id }).sort({ fecha: -1 }).select("fecha"),
      Pago.findOne({ registradoPor: usuario._id }).sort({ fecha: -1 }).select("fecha"),
      ErrorCliente.countDocuments({ usuario: usuario._id, createdAt: { $gte: desde30 } }),
    ]);

  return {
    usuario: usuario.toJSON(),
    pendiente: pendienteDe(usuario),
    marca,
    actividad: {
      ultimoAcceso: usuario.ultimoAcceso ?? null,
      ultimaVersionApp: usuario.ultimaVersionApp ?? null,
      ticketsRegistrados,
      pagosRegistrados,
      ultimoTicketEl: ultimoTicket?.fecha ?? null,
      ultimoPagoEl: ultimoPago?.fecha ?? null,
      erroresApp30d: errores30d,
    },
  };
}

function textoObligatorio(valor: unknown, campo: string, maximo: number): string {
  if (typeof valor !== "string" || !valor.trim()) {
    throw errorDeCampo(campo, `El campo "${campo}" es requerido`);
  }
  const limpio = valor.trim();
  if (limpio.length > maximo) throw errorDeCampo(campo, `"${campo}" puede tener hasta ${maximo} caracteres`);
  return limpio;
}

function leerEmail(valor: unknown): string {
  const email = textoObligatorio(valor, "email", 200).toLowerCase();
  if (!EMAIL_VALIDO.test(email)) throw errorDeCampo("email", "El email no tiene un formato válido");
  return email;
}

async function exigirEmailLibre(email: string, salvo?: UsuarioDocument): Promise<void> {
  const otro = await Usuario.findOne({ email }).select("_id");
  if (otro && !(salvo && otro._id.equals(salvo._id))) {
    throw errorDeCampo("email", "Ya hay una cuenta registrada con ese email", 409);
  }
}

async function exigirDniLibre(dni: string, salvo?: UsuarioDocument): Promise<void> {
  const otro = await Usuario.findOne({ dni }).select("_id");
  if (otro && !(salvo && otro._id.equals(salvo._id))) {
    throw errorDeCampo("dni", "Ya hay una cuenta con ese DNI", 409);
  }
}

/**
 * POST /admin/usuarios   { nombre, email, password, rol?, dni? }
 *
 * La cuenta nace sin términos aceptados: la persona los acepta al entrar por
 * primera vez, como cualquier otra. El rol, si no viene, es administrador.
 */
export async function crearUsuario(body: Record<string, unknown> | undefined) {
  const nombre = textoObligatorio(body?.["nombre"], "nombre", 100);
  const email = leerEmail(body?.["email"]);
  const password = body?.["password"];
  if (typeof password !== "string" || password.length < 6) {
    throw errorDeCampo("password", "La contraseña debe tener al menos 6 caracteres");
  }

  const rolCrudo = body?.["rol"];
  if (rolCrudo !== undefined && rolCrudo !== null && rolCrudo !== "" && !esRol(rolCrudo)) {
    throw errorDeCampo("rol", `"rol" tiene que ser uno de: ${ROLES.join(", ")}`);
  }
  const rol = esRol(rolCrudo) ? rolCrudo : ROL_POR_DEFECTO;

  let dni: string | undefined;
  const dniCrudo = body?.["dni"];
  if (dniCrudo !== undefined && dniCrudo !== null && dniCrudo !== "") {
    dni = normalizarDni(dniCrudo) ?? undefined;
    if (!dni) throw errorDeCampo("dni", "El DNI tiene que tener 7 u 8 números");
    await exigirDniLibre(dni);
  }

  await exigirEmailLibre(email);
  const usuario = await Usuario.create({ nombre, email, password, rol, ...(dni && { dni }) });
  logger.success(`[admin] cuenta creada: ${enmascararEmail(email)} (${rol})`);
  return conPendiente(usuario);
}

/**
 * PUT /admin/usuarios/:id   { nombre?, email?, dni? }
 *
 * Corregir los datos de una cuenta. Solo cambia lo que viene. El DNI se
 * puede sacar con null: la persona vuelve a "completá tu perfil".
 */
export async function editarUsuario(id: unknown, body: Record<string, unknown> | undefined) {
  const usuario = await buscarUsuario(id);
  const $set: Record<string, unknown> = {};
  const $unset: Record<string, ""> = {};

  if (body?.["nombre"] !== undefined) $set["nombre"] = textoObligatorio(body["nombre"], "nombre", 100);

  if (body?.["email"] !== undefined) {
    const email = leerEmail(body["email"]);
    await exigirEmailLibre(email, usuario);
    $set["email"] = email;
  }

  if (body?.["dni"] !== undefined) {
    if (body["dni"] === null || body["dni"] === "") {
      if (usuario.marca) {
        throw errorDeCampo("dni", "No se puede sacar el DNI de alguien que ya está en una marca");
      }
      $unset["dni"] = "";
    } else {
      const dni = normalizarDni(body["dni"]);
      if (!dni) throw errorDeCampo("dni", "El DNI tiene que tener 7 u 8 números");
      await exigirDniLibre(dni, usuario);
      $set["dni"] = dni;
    }
  }

  if (Object.keys($set).length === 0 && Object.keys($unset).length === 0) {
    throw new AppError("No vino nada para cambiar: mandá nombre, email o dni", 400);
  }

  await Usuario.updateOne(
    { _id: usuario._id },
    { ...(Object.keys($set).length > 0 && { $set }), ...(Object.keys($unset).length > 0 && { $unset }) },
    { runValidators: true }
  );
  logger.info(`[admin] cuenta editada: ${enmascararEmail(usuario.email)} (${Object.keys({ ...$set, ...$unset }).join(", ")})`);
  return detalleUsuario(usuario._id);
}

/**
 * POST /admin/usuarios/:id/suspender   { motivo? }
 *
 * No puede entrar ni usar la sesión que tenía abierta (ver requireAuth). Sus
 * datos y su marca quedan como están; si la marca tiene otros dueños, ellos
 * siguen trabajando normalmente.
 */
export async function suspenderUsuario(id: unknown, yo: UsuarioDocument, motivoCrudo: unknown) {
  const usuario = await buscarUsuario(id);
  exigirAdministrador(usuario, yo, "suspender");

  if (motivoCrudo !== undefined && motivoCrudo !== null && typeof motivoCrudo !== "string") {
    throw errorDeCampo("motivo", '"motivo" tiene que ser texto');
  }
  const motivo = typeof motivoCrudo === "string" ? motivoCrudo.trim() : "";
  if (motivo.length > 300) throw errorDeCampo("motivo", '"motivo" puede tener hasta 300 caracteres');

  await Usuario.updateOne(
    { _id: usuario._id },
    motivo
      ? { $set: { suspendida: true, suspendidaEl: new Date(), motivoSuspension: motivo } }
      : { $set: { suspendida: true, suspendidaEl: new Date() }, $unset: { motivoSuspension: "" } }
  );
  logger.warn(`[admin] cuenta suspendida: ${enmascararEmail(usuario.email)}`);
  return detalleUsuario(usuario._id);
}

/** POST /admin/usuarios/:id/reactivar */
export async function reactivarUsuario(id: unknown) {
  const usuario = await buscarUsuario(id);
  await Usuario.updateOne(
    { _id: usuario._id },
    { $set: { suspendida: false }, $unset: { suspendidaEl: "", motivoSuspension: "" } }
  );
  logger.info(`[admin] cuenta reactivada: ${enmascararEmail(usuario.email)}`);
  return detalleUsuario(usuario._id);
}

/**
 * POST /admin/usuarios/:id/cerrar-sesiones
 *
 * Invalida todos sus tokens (el mismo mecanismo que un cambio de contraseña)
 * sin tocarle la contraseña: sirve si perdió el teléfono.
 */
export async function cerrarSesiones(id: unknown, yo: UsuarioDocument) {
  const usuario = await buscarUsuario(id);
  exigirAdministrador(usuario, yo, "cerrar las sesiones de");
  await Usuario.updateOne({ _id: usuario._id }, { $set: { passwordCambiadoEn: new Date() } });
  logger.info(`[admin] sesiones cerradas: ${enmascararEmail(usuario.email)}`);
  return { mensaje: "Listo: tiene que volver a iniciar sesión en todos sus dispositivos" };
}

/**
 * DELETE /admin/usuarios/:id   { confirmar: "ELIMINAR", eliminarMarca? }
 *
 * Usa la misma baja que la persona pide desde la app (services/eliminacionCuenta.ts):
 * si la marca tiene otros dueños, queda viva; si era el único dueño, se va la
 * marca con todos sus datos. Ese segundo caso tiene que confirmarse aparte con
 * `eliminarMarca: true`, porque no tiene vuelta atrás.
 */
export async function eliminarUsuario(id: unknown, yo: UsuarioDocument, body: Record<string, unknown> | undefined) {
  if (body?.["confirmar"] !== "ELIMINAR") {
    throw errorDeCampo("confirmar", 'Para eliminar la cuenta mandá { "confirmar": "ELIMINAR" }');
  }

  const usuario = await buscarUsuario(id);
  exigirAdministrador(usuario, yo, "eliminar");

  if (usuario.marca) {
    const [marca, duenos] = await Promise.all([
      Marca.findById(usuario.marca).select("nombre estadisticas"),
      Usuario.countDocuments({ marca: usuario.marca }),
    ]);
    if (marca && duenos <= 1 && body["eliminarMarca"] !== true) {
      throw new AppError(
        `Es el único dueño de "${marca.nombre}": eliminarlo borra la marca con todos sus clientes, facturas, tickets y pagos. Para confirmarlo mandá "eliminarMarca": true.`,
        409,
        { marca: { _id: marca._id, nombre: marca.nombre, estadisticas: marca.estadisticas } },
        "UNICO_DUENO"
      );
    }
  }

  const resultado = await eliminarCuenta(usuario);
  logger.warn(`[admin] cuenta eliminada: ${enmascararEmail(usuario.email)}`);
  return { mensaje: "Cuenta eliminada", ...resultado };
}
