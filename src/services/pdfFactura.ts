import type { FacturaDocument } from "../models/Factura.js";
import type { ClienteDocument } from "../models/Cliente.js";
import Marca from "../models/Marca.js";
import { faltanteDe } from "../models/Ticket.js";
import { detalleFactura } from "./facturacion.js";
import { traerLogo, type LogoMarca } from "./cloudinary.js";
import { documentoFactura, type DatosPdfFactura } from "../pdf/facturaDocumento.js";
import { renderizarPdf } from "../pdf/motor.js";
import { fechaIso, formatearFecha, formatearPesos, numeroFactura, slug } from "../utils/formato.js";

/**
 * La factura en PDF, lista para descargar, adjuntar o abrir por link.
 *
 * No se guarda nada: se arma en el momento con los datos al día. Un link que
 * se mandó con la factura abierta, abierto una semana después, muestra el
 * saldo de ese día — que es lo que el cliente debe.
 *
 * Sale con la marca dueña de la factura (su nombre y su logo), nunca con la
 * de la app. Se busca por la factura y no por el usuario logueado: el link
 * público no tiene a nadie logueado.
 */

/** Junta todo lo que va en el PDF, ya sin anulados y sin mongoose. */
export async function datosPdfFactura(
  factura: FacturaDocument,
  cliente?: ClienteDocument
): Promise<{ datos: DatosPdfFactura; logo: LogoMarca | null }> {
  const [detalle, marca] = await Promise.all([
    detalleFactura(factura, cliente),
    Marca.findById(factura.marca),
  ]);

  const c = detalle.cliente;
  if (!c) throw new Error(`La factura ${String(factura._id)} no tiene cliente`);

  // Sin logo (o si Cloudinary no responde) el PDF sale igual, con el nombre.
  const logo = await traerLogo(marca?.logoUrl);

  const datos: DatosPdfFactura = {
    marca: {
      nombre: marca?.nombre ?? "Resumen de cuenta",
      direccion: marca?.direccion,
      telefono: marca?.telefono,
      logo: logo?.dataUrl,
      colorPrimario: marca?.colorPrimario,
      colorSecundario: marca?.colorSecundario,
    },
    cliente: { nombre: c.nombre, dni: c.dni, telefono: c.telefono, direccion: c.direccion },
    factura: {
      numero: factura.numero,
      estado: factura.estado,
      vencida: detalle.factura.vencida,
      diasParaVencer: detalle.factura.diasParaVencer,
      porcentajeCobrado: detalle.factura.porcentajeCobrado,
      desde: factura.desde,
      venceEl: factura.venceEl,
      pagadaEl: factura.pagadaEl,
      totalFiado: factura.totalFiado,
      totalPagos: factura.totalPagos,
      saldo: factura.saldo,
    },
    // Lo anulado se ve tachado en la app, pero al cliente no se le manda: no
    // cuenta, y en un PDF un renglón tachado se lee como un error.
    tickets: detalle.tickets
      .filter((t) => !t.anulado)
      .map((t) => ({
        fecha: t.fecha,
        items: t.items.map((i) => ({
          nombre: i.nombre,
          talle: i.talle,
          cantidad: i.cantidad,
          subtotal: i.subtotal,
        })),
        total: t.total,
        pagado: t.pagado ?? 0,
        faltante: faltanteDe(t),
      })),
    pagos: detalle.pagos
      .filter((p) => !p.anulado)
      .map((p) => ({ fecha: p.fecha, monto: p.monto, metodoPago: p.metodoPago ?? "efectivo" })),
    generadoEl: new Date(),
  };

  return { datos, logo };
}

/** "factura-0012-ana-lopez.pdf" o "factura-en-curso-ana-lopez-2026-09-10.pdf". */
export function nombreArchivoFactura(d: DatosPdfFactura): string {
  const cliente = slug(d.cliente.nombre);
  return d.factura.numero
    ? `factura-${String(d.factura.numero).padStart(4, "0")}-${cliente}.pdf`
    : `factura-en-curso-${cliente}-${fechaIso(d.generadoEl)}.pdf`;
}

/**
 * El título de la factura activa. El mail la reconoce por este texto para
 * armar su asunto (emails/plantillas/facturaCliente.ts).
 */
const TITULO_FACTURA_EN_CURSO = "Factura en curso";

/** Lo mínimo de una factura para contar cómo está. */
interface FacturaParaResumen {
  numero?: number | undefined;
  saldo: number;
  venceEl: Date;
  vencida: boolean;
}

/**
 * Cómo está la cuenta, en palabras. Lo usan el mail y el mensaje de WhatsApp,
 * así la misma situación se cuenta igual en los dos lados.
 */
export function resumenFactura(f: FacturaParaResumen) {
  const numero = numeroFactura(f.numero);
  const alDia = f.saldo <= 0;
  const vencimiento = alDia ? null : `${f.vencida ? "venció" : "vence"} el ${formatearFecha(f.venceEl)}`;

  return {
    /** "Factura N° 0012" o "Factura en curso" (la activa todavía no tiene número). */
    titulo: numero ? `Factura ${numero}` : TITULO_FACTURA_EN_CURSO,
    saldo: formatearPesos(Math.max(f.saldo, 0)),
    alDia,
    vencida: f.vencida,
    vencimiento,
    /** "debés $ 12.500, vence el 10/10/2026" o "estás al día". */
    frase: alDia ? "estás al día" : `debés ${formatearPesos(f.saldo)}, ${vencimiento}`,
  };
}

/**
 * El PDF, su nombre de archivo, los datos con que se armó y el logo de la
 * marca (el mail lo reusa para no ir a buscarlo dos veces).
 */
export async function generarPdfFactura(
  factura: FacturaDocument,
  opciones: { cliente?: ClienteDocument } = {}
) {
  const { datos, logo } = await datosPdfFactura(factura, opciones.cliente);
  const buffer = await renderizarPdf(documentoFactura(datos));
  return { buffer, nombreArchivo: nombreArchivoFactura(datos), datos, logo };
}
