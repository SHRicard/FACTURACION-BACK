import { Types } from "mongoose";
import Marca, {
  CAMPOS_COLOR_MARCA,
  LARGO_MAXIMO_MARCA,
  type MarcaDocument,
} from "../models/Marca.js";
import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import Cliente from "../models/Cliente.js";
import Ticket from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Factura from "../models/Factura.js";
import { AppError, datosInvalidos, noEncontrado } from "../utils/AppError.js";
import { normalizarColor, normalizarDni } from "../utils/validaciones.js";
import { logger } from "../utils/logger.js";

/**
 * La marca y sus dueños.
 *
 * Reglas:
 *   - Un usuario está en UNA sola marca. No se pasa de una a otra.
 *   - Una marca tiene N dueños, todos iguales.
 *   - Se suma a alguien por DNI, al instante, si todavía no tiene marca.
 *   - Cualquier dueño saca a otro o se va. La marca nunca queda sin dueños.
 *   - El que sale queda sin marca y vuelve a empezar; no se lleva nada.
 */

// El dueño de la marca, como sale en las respuestas.
const CAMPOS_DUENO = "nombre email dni avatar";

/** La marca con sus dueños cargados, lista para responder. */
export async function marcaConDuenos(marcaId: Types.ObjectId | string) {
  return Marca.findById(marcaId).populate({ path: "duenos", select: CAMPOS_DUENO });
}

type DatosMarca = {
  nombre?: string;
  direccion?: string;
  telefono?: string;
  colorPrimario?: string;
  colorSecundario?: string;
};

/**
 * Valida los datos de la marca. Sin nombre no hay marca. En la edición, un
 * texto vacío o ausente se borra (salvo el nombre).
 *
 * Los colores son distintos: se tocan solo si vienen. El formulario de edición
 * de antes no los manda, y no tiene que borrarlos. `null` o "" los saca, y el
 * PDF vuelve a la paleta de la app.
 */
export function leerDatosMarca(body: Record<string, unknown> | undefined) {
  const $set: DatosMarca = {};
  const $unset: Record<string, ""> = {};

  for (const [campo, maximo] of Object.entries(LARGO_MAXIMO_MARCA) as [keyof DatosMarca, number][]) {
    const valor = body?.[campo];
    if (valor !== undefined && valor !== null && typeof valor !== "string") {
      throw datosInvalidos(`El campo "${campo}" tiene que ser texto`, { campo });
    }

    const limpio = typeof valor === "string" ? valor.trim() : "";
    if (limpio.length > maximo) {
      throw datosInvalidos(`El campo "${campo}" puede tener hasta ${maximo} caracteres`, {
        campo,
        maximo,
      });
    }

    if (limpio) $set[campo] = limpio;
    else if (campo !== "nombre") $unset[campo] = "";
  }

  for (const campo of CAMPOS_COLOR_MARCA) {
    const valor = body?.[campo];
    if (valor === undefined) continue;
    if (valor === null || valor === "") {
      $unset[campo] = "";
      continue;
    }

    const color = normalizarColor(valor);
    if (!color) {
      throw datosInvalidos(`El campo "${campo}" tiene que ser un color hex, como #4a1866`, {
        campo,
      });
    }
    $set[campo] = color;
  }

  if (!$set.nombre) throw datosInvalidos("La marca necesita un nombre", { campo: "nombre" });
  return { $set, $unset };
}

/**
 * Crea la marca y deja al usuario como su primer dueño.
 *
 * El usuario se actualiza con la condición "todavía sin marca": si dos
 * pedidos llegan juntos, el segundo no encuentra al usuario libre y la marca
 * que llegó a crear se borra.
 */
export async function crearMarca(usuario: UsuarioDocument, body: Record<string, unknown> | undefined) {
  if (!usuario.dni) {
    throw new AppError("Completá tu perfil con tu DNI antes de crear tu marca", 403, {
      pendiente: "perfil",
    });
  }
  if (usuario.marca) throw new AppError("Ya tenés una marca", 409);

  const { $set } = leerDatosMarca(body);
  const marca = await Marca.create({ ...$set, creadaPor: usuario._id });

  const tomado = await Usuario.findOneAndUpdate(
    { _id: usuario._id, marca: null },
    { marca: marca._id },
    { new: true }
  );
  if (!tomado) {
    await Marca.deleteOne({ _id: marca._id });
    throw new AppError("Ya tenés una marca", 409);
  }

  logger.success(`Marca nueva: ${marca.nombre} (de ${usuario.email})`);
  return marcaConDuenos(marca._id);
}

/** Suma un dueño por DNI. Solo si esa persona todavía no tiene marca. */
export async function sumarDueno(marca: MarcaDocument, dniCrudo: unknown) {
  const dni = normalizarDni(dniCrudo);
  if (!dni) throw datosInvalidos("El DNI tiene que tener 7 u 8 números", { campo: "dni" });

  const sumado = await Usuario.findOneAndUpdate(
    { dni, rol: "administrador", marca: null },
    { marca: marca._id },
    { new: true }
  );

  if (!sumado) {
    // No se pudo: se averigua por qué, para decirlo claro.
    const persona = await Usuario.findOne({ dni });
    if (!persona) {
      throw noEncontrado("No hay ninguna cuenta con ese DNI. Tiene que registrarse y cargar su DNI primero");
    }
    if (persona.rol !== "administrador") {
      throw datosInvalidos("Esa cuenta no puede sumarse a una marca");
    }
    if (String(persona.marca) === String(marca._id)) {
      throw new AppError("Esa persona ya es dueña de esta marca", 409);
    }
    throw new AppError("Esa persona ya tiene su propia marca", 409);
  }

  logger.info(`${sumado.email} se sumó a la marca ${marca.nombre}`);
  return marcaConDuenos(marca._id);
}

/**
 * Saca a un dueño (o se va, si es el propio usuario). La marca nunca queda
 * sin dueños: el último no puede salir.
 */
export async function sacarDueno(marca: MarcaDocument, usuarioId: string) {
  if (!Types.ObjectId.isValid(usuarioId)) throw noEncontrado("Dueño");

  const [dueno, cantidad] = await Promise.all([
    Usuario.findOne({ _id: usuarioId, marca: marca._id }),
    Usuario.countDocuments({ marca: marca._id }),
  ]);
  if (!dueno) throw noEncontrado("Dueño");
  if (cantidad <= 1) {
    throw datosInvalidos(
      "Es el único dueño: la marca no puede quedar sin dueños. Sumá a alguien antes de salir."
    );
  }

  await Usuario.updateOne({ _id: dueno._id }, { $unset: { marca: "" } });
  logger.info(`${dueno.email} dejó la marca ${marca.nombre}`);
  return marcaConDuenos(marca._id);
}

const redondear = (n: number): number => Math.round(n * 100) / 100;

/**
 * Recalcula lo que mueve la marca, desde cero.
 *
 * Igual que los totales de la factura: se guardan para leerlos en una
 * consulta, pero no hay ningún lugar que los sume a mano. Se llama después de
 * cada cambio (ver recalcularFactura y el alta de clientes).
 */
export async function recalcularMarca(marcaId: Types.ObjectId | string): Promise<void> {
  // aggregate no convierte tipos como find: el $match necesita un ObjectId.
  const marca = new Types.ObjectId(String(marcaId));
  const activos = { marca, anulado: { $ne: true } };

  const [cantidadClientes, tickets, pagos, facturas] = await Promise.all([
    Cliente.countDocuments({ marca }),
    Ticket.aggregate<{ vendido: number; dejado: number }>([
      { $match: activos },
      { $group: { _id: null, vendido: { $sum: "$total" }, dejado: { $sum: "$pagado" } } },
    ]),
    Pago.aggregate<{ cobrado: number }>([
      { $match: activos },
      { $group: { _id: null, cobrado: { $sum: "$monto" } } },
    ]),
    // Toda factura no anulada que deba algo. No se filtra por abierta:
    // al anular el pago que saldaba una factura, se recalcula cuando todavía
    // figura "pagada" (el estado se ajusta un paso después) y quedaría afuera.
    Factura.aggregate<{ deuda: number }>([
      { $match: { marca, estado: { $ne: "anulada" }, saldo: { $gt: 0 } } },
      { $group: { _id: null, deuda: { $sum: "$saldo" } } },
    ]),
  ]);

  await Marca.updateOne(
    { _id: marca },
    {
      $set: {
        estadisticas: {
          cantidadClientes,
          totalVendido: redondear(tickets[0]?.vendido ?? 0),
          totalCobrado: redondear((tickets[0]?.dejado ?? 0) + (pagos[0]?.cobrado ?? 0)),
          deudaPendiente: redondear(facturas[0]?.deuda ?? 0),
          actualizadasEl: new Date(),
        },
      },
    }
  );
}
