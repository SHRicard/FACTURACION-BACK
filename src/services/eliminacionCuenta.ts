import Usuario, { type UsuarioDocument } from "../models/Usuario.js";
import Marca from "../models/Marca.js";
import Cliente from "../models/Cliente.js";
import Factura from "../models/Factura.js";
import Ticket from "../models/Ticket.js";
import Pago from "../models/Pago.js";
import Producto from "../models/Producto.js";
import Especie from "../models/Especie.js";
import { eliminarImagen, publicIdLogo } from "./cloudinary.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../utils/logger.js";

export type ResultadoEliminacion = {
  usuarioEliminado: boolean;
  marcaEliminada: boolean;
  datosDelNegocioEliminados: boolean;
};

/**
 * Elimina una cuenta y todo lo que pueda identificarla.
 *
 * Una marca compartida no se elimina porque contiene datos de otros dueños.
 * En ese caso se transfiere la referencia de creadaPor si hace falta y se
 * quita registradoPor de tickets y pagos históricos del usuario eliminado.
 *
 * El usuario se borra SIEMPRE al final. No hay transacción (Mongo las pide
 * con replica set), así que si algo falla a mitad de camino la cuenta sigue
 * viva y la persona puede volver a pedir la baja; al revés quedarían datos
 * del negocio sin dueño y sin forma de llegar a ellos.
 */
export async function eliminarCuenta(usuario: UsuarioDocument): Promise<ResultadoEliminacion> {
  if (usuario.rol === "super_admin") {
    throw new AppError("La cuenta principal del sistema no se puede eliminar desde esta ruta", 403);
  }

  const usuarioId = usuario._id;
  const marcaId = usuario.marca;

  if (!marcaId) {
    await Usuario.deleteOne({ _id: usuarioId });
    return { usuarioEliminado: true, marcaEliminada: false, datosDelNegocioEliminados: false };
  }

  const duenos = await Usuario.find({ marca: marcaId }).select("_id");
  const otrosDuenos = duenos.filter((dueno) => !dueno._id.equals(usuarioId));

  // La marca queda viva porque es de los otros dueños. Lo único que se va es
  // esta cuenta y su rastro en lo que había registrado.
  if (otrosDuenos.length > 0) {
    const marca = await Marca.findById(marcaId).select("creadaPor");
    if (marca?.creadaPor.equals(usuarioId)) {
      await Marca.updateOne({ _id: marcaId }, { $set: { creadaPor: otrosDuenos[0]!._id } });
    }

    await Promise.all([
      Ticket.updateMany({ marca: marcaId, registradoPor: usuarioId }, { $unset: { registradoPor: "" } }),
      Pago.updateMany({ marca: marcaId, registradoPor: usuarioId }, { $unset: { registradoPor: "" } }),
    ]);

    const borradoUsuario = await Usuario.deleteOne({ _id: usuarioId });

    logger.info(`Cuenta eliminada y referencias anonimizadas: ${String(usuarioId)}`);
    return {
      usuarioEliminado: borradoUsuario.deletedCount === 1,
      marcaEliminada: false,
      datosDelNegocioEliminados: false,
    };
  }

  // Era la única dueña: con la cuenta se va el negocio entero.
  const marcaIdTexto = String(marcaId);
  await Promise.all([
    Cliente.deleteMany({ marca: marcaId }),
    Factura.deleteMany({ marca: marcaId }),
    Ticket.deleteMany({ marca: marcaId }),
    Pago.deleteMany({ marca: marcaId }),
    Producto.deleteMany({ marca: marcaId }),
    Especie.deleteMany({ marca: marcaId }),
  ]);

  const borradoMarca = await Marca.deleteOne({ _id: marcaId });
  const borradoUsuario = await Usuario.deleteOne({ _id: usuarioId });

  // El logo vive en Cloudinary, no en la base. No frena la baja: si falla, se
  // loguea y queda un archivo suelto que ya no está referenciado por nadie.
  void eliminarImagen(publicIdLogo(marcaIdTexto));
  logger.info(`Cuenta, marca y datos eliminados: ${String(usuarioId)} / ${marcaIdTexto}`);

  return {
    usuarioEliminado: borradoUsuario.deletedCount === 1,
    marcaEliminada: borradoMarca.deletedCount === 1,
    datosDelNegocioEliminados: true,
  };
}