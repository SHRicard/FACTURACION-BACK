import type {
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces.js";
import type { EstadoFactura } from "../models/Factura.js";
import type { MetodoPago } from "../models/Pago.js";
import { color } from "../emails/tokens.js";
import { paletaPdf, type PaletaPdf } from "./paleta.js";
import {
  diasEntre,
  formatearFecha,
  formatearFechaCorta,
  formatearFechaHora,
  formatearPesos,
  numeroFactura,
} from "../utils/formato.js";

/**
 * La factura en PDF, diseño "resumen de cuenta".
 *
 * Primero lo que el cliente quiere saber —cuánto debe y para cuándo—, y abajo
 * la libreta: cada compra y cada pago en orden, con el saldo acumulado. Así el
 * número grande se explica solo, renglón por renglón.
 *
 * Esto es una función pura: recibe datos planos y devuelve la definición del
 * documento. No toca la base ni pdfmake.
 */

export interface ItemPdf {
  nombre: string;
  talle?: string | undefined;
  cantidad: number;
  subtotal: number;
}

export interface TicketPdf {
  fecha: Date;
  items: ItemPdf[];
  total: number;
  pagado: number;
  /** total − pagado: lo que quedó anotado. */
  faltante: number;
}

export interface PagoPdf {
  fecha: Date;
  monto: number;
  metodoPago: MetodoPago;
}

export interface DatosPdfFactura {
  /** La marca del usuario: el PDF sale con su nombre y su logo, no con los de la app. */
  marca: {
    nombre: string;
    direccion?: string | undefined;
    telefono?: string | undefined;
    /** PNG como data URL. Sin logo, el encabezado lleva solo el nombre. */
    logo?: string | undefined;
    /** "#rrggbb". Sin colores, sale la paleta de la app (ver pdf/paleta.ts). */
    colorPrimario?: string | undefined;
    colorSecundario?: string | undefined;
  };
  cliente: {
    nombre: string;
    dni: string;
    telefono?: string | undefined;
    direccion?: string | undefined;
  };
  factura: {
    numero?: number | undefined;
    estado: EstadoFactura;
    vencida: boolean;
    diasParaVencer: number;
    porcentajeCobrado: number;
    desde: Date;
    venceEl: Date;
    pagadaEl?: Date | undefined;
    totalFiado: number;
    totalPagos: number;
    saldo: number;
  };
  /** Sin los anulados: el PDF muestra lo que cuenta. */
  tickets: TicketPdf[];
  pagos: PagoPdf[];
  generadoEl: Date;
}

// A4 menos los márgenes laterales.
const ANCHO_UTIL = 595.28 - 80;
const PADDING_HEROE = 18;
const ANCHO_BARRA = ANCHO_UTIL - PADDING_HEROE * 2;

const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "Mercado Pago",
  otro: "Otro",
};

const menos = (monto: number): string => `− ${formatearPesos(monto)}`;
const plural = (n: number, uno: string, varios: string): string =>
  n === 1 ? uno : varios;

/** El rótulo de estado: color y texto según cómo está la cuenta. */
function insignia(f: DatosPdfFactura["factura"], hoy: Date, p: PaletaPdf) {
  // Días de calendario, no horas redondeadas: si vence hoy a la noche, dice "hoy".
  const dias = Math.abs(diasEntre(hoy, f.venceEl));
  const cuantos = `${dias} ${plural(dias, "DÍA", "DÍAS")}`;

  if (f.estado === "anulada") {
    return {
      texto: "ANULADA",
      fondo: color.borde,
      tinta: color.textoSuave,
      borde: color.borde,
    };
  }
  if (f.estado === "pagada") {
    return {
      texto: f.pagadaEl ? `PAGADA EL ${formatearFecha(f.pagadaEl)}` : "PAGADA",
      fondo: p.primario,
      tinta: color.blanco,
      borde: p.primario,
    };
  }
  if (f.saldo <= 0) {
    return {
      texto: "AL DÍA",
      fondo: color.blanco,
      tinta: p.secundario,
      borde: p.borde,
    };
  }
  if (f.vencida) {
    return {
      texto:
        dias === 0
          ? "VENCIÓ HOY"
          : `VENCIÓ EL ${formatearFechaCorta(f.venceEl)} · HACE ${cuantos}`,
      fondo: color.ambarFondo,
      tinta: color.ambar,
      borde: color.ambarBorde,
    };
  }
  return {
    texto:
      dias === 0
        ? "VENCE HOY"
        : `VENCE EL ${formatearFecha(f.venceEl)} · EN ${cuantos}`,
    fondo: color.blanco,
    tinta: p.secundario,
    borde: p.borde,
  };
}

/** La marca: nombre y datos a la izquierda, su logo a la derecha si tiene. */
function cabecera(d: DatosPdfFactura, p: PaletaPdf): Content {
  const lineas: Content[] = [
    {
      text: d.marca.nombre,
      font: "InterSemi",
      fontSize: 18,
      color: p.primario,
    },
  ];
  if (d.marca.direccion) {
    lineas.push({
      text: d.marca.direccion,
      color: color.textoSuave,
      margin: [0, 4, 0, 0],
    });
  }
  if (d.marca.telefono) {
    lineas.push({ text: `Tel. ${d.marca.telefono}`, color: color.textoSuave });
  }

  if (!d.marca.logo) return { stack: lineas };

  return {
    columns: [
      { width: "*", stack: lineas },
      { width: 150, image: d.marca.logo, fit: [140, 50], alignment: "right" },
    ],
    columnGap: 20,
  };
}

/** De qué es esta factura, en una línea. */
function subtitulo(f: DatosPdfFactura["factura"]): string {
  const numero = numeroFactura(f.numero);
  if (!numero) return `Factura en curso · desde el ${formatearFecha(f.desde)}`;
  if (f.pagadaEl)
    return `Factura ${numero} · saldada el ${formatearFecha(f.pagadaEl)}`;
  return `Factura ${numero}`;
}

/** El bloque grande: quién, cuánto debe, para cuándo y cuánto ya pagó. */
function heroe(d: DatosPdfFactura, p: PaletaPdf): Content {
  const f = d.factura;
  const estado = insignia(f, d.generadoEl, p);

  const contacto = [
    `DNI ${d.cliente.dni}`,
    d.cliente.telefono && `Tel. ${d.cliente.telefono}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const izquierda: Content[] = [
    {
      text: d.cliente.nombre,
      font: "InterSemi",
      fontSize: 13,
      color: color.tinta,
    },
    { text: contacto, color: color.textoSuave, margin: [0, 2, 0, 0] },
  ];
  if (d.cliente.direccion)
    izquierda.push({ text: d.cliente.direccion, color: color.textoSuave });
  izquierda.push({
    text: subtitulo(f),
    color: color.textoSuave,
    margin: [0, 8, 0, 0],
  });

  const derecha: Content[] = [
    {
      text: f.saldo > 0 ? "SALDO A PAGAR" : "SALDO",
      font: "InterSemi",
      fontSize: 7.5,
      characterSpacing: 1,
      color: p.secundario,
      alignment: "right",
    },
    {
      text: formatearPesos(Math.max(f.saldo, 0)),
      bold: true,
      fontSize: 30,
      color: p.primario,
      alignment: "right",
      margin: [0, 2, 0, 6],
    },
    {
      columns: [
        { width: "*", text: "" },
        {
          width: "auto",
          table: {
            body: [
              [
                {
                  text: estado.texto,
                  bold: true,
                  fontSize: 7.5,
                  characterSpacing: 0.6,
                  color: estado.tinta,
                  fillColor: estado.fondo,
                },
              ],
            ],
          },
          layout: {
            hLineWidth: () => 0.8,
            vLineWidth: () => 0.8,
            hLineColor: () => estado.borde,
            vLineColor: () => estado.borde,
            paddingLeft: () => 6,
            paddingRight: () => 6,
            paddingTop: () => 3,
            paddingBottom: () => 3,
          },
        },
      ],
    },
  ];

  const cuerpo: Content[] = [
    {
      columns: [
        { width: "*", stack: izquierda },
        { width: 210, stack: derecha },
      ],
      columnGap: 16,
    },
  ];

  // La barra solo tiene sentido si hubo algo anotado.
  if (f.totalFiado > 0) {
    const relleno =
      (ANCHO_BARRA * Math.min(Math.max(f.porcentajeCobrado, 0), 100)) / 100;
    cuerpo.push({
      canvas: [
        {
          type: "rect",
          x: 0,
          y: 0,
          w: ANCHO_BARRA,
          h: 5,
          r: 2.5,
          color: color.blanco,
          lineColor: p.borde,
          lineWidth: 0.6,
        },
        ...(relleno > 0
          ? [
              {
                type: "rect" as const,
                x: 0,
                y: 0,
                w: relleno,
                h: 5,
                r: 2.5,
                color: p.relleno,
              },
            ]
          : []),
      ],
      margin: [0, 14, 0, 5],
    });
    cuerpo.push({
      text:
        f.totalPagos > 0
          ? `Pagaste ${formatearPesos(f.totalPagos)} de los ${formatearPesos(f.totalFiado)} que quedaron anotados · ${f.porcentajeCobrado} %`
          : `Todavía no hay pagos a cuenta de los ${formatearPesos(f.totalFiado)} anotados.`,
      fontSize: 8,
      color: color.textoSuave,
    });
  }

  return {
    table: { widths: ["*"], body: [[{ stack: cuerpo, fillColor: p.panel }]] },
    layout: {
      hLineWidth: () => 0.8,
      vLineWidth: () => 0.8,
      hLineColor: () => p.borde,
      vLineColor: () => p.borde,
      paddingLeft: () => PADDING_HEROE,
      paddingRight: () => PADDING_HEROE,
      paddingTop: () => 16,
      paddingBottom: () => 16,
    },
    margin: [0, 18, 0, 0],
  };
}

interface Movimiento {
  fecha: Date;
  /** Si una compra y un pago tienen la misma hora, va primero la compra. */
  orden: 0 | 1;
  tipo: "Compra" | "Pago";
  detalle: Content;
  suma?: number;
  resta?: number;
}

function movimientos(d: DatosPdfFactura): Movimiento[] {
  const compras: Movimiento[] = d.tickets.map((t) => {
    const renglones: Content[] = t.items.map((i) => ({
      columns: [
        {
          width: "*",
          text: `${i.cantidad} × ${i.nombre}${i.talle ? ` · T. ${i.talle}` : ""}`,
        },
        {
          width: "auto",
          text: formatearPesos(i.subtotal),
          color: color.textoTenue,
          fontSize: 8,
        },
      ],
      columnGap: 8,
    }));

    if (t.pagado > 0) {
      renglones.push({
        text: `Total ${formatearPesos(t.total)} · dejaste ${formatearPesos(t.pagado)} en el momento`,
        fontSize: 7.5,
        color: color.textoTenue,
        margin: [0, 2, 0, 0],
      });
    }

    return {
      fecha: t.fecha,
      orden: 0,
      tipo: "Compra",
      detalle: { stack: renglones },
      suma: t.faltante,
    };
  });

  const pagos: Movimiento[] = d.pagos.map((p) => ({
    fecha: p.fecha,
    orden: 1,
    tipo: "Pago",
    detalle: {
      text: `Pago a cuenta · ${NOMBRE_METODO[p.metodoPago] ?? "Otro"}`,
    },
    resta: p.monto,
  }));

  return [...compras, ...pagos].sort(
    (a, b) => a.fecha.getTime() - b.fecha.getTime() || a.orden - b.orden,
  );
}

/** La libreta: cada movimiento con el saldo como iba quedando. */
function tablaMovimientos(d: DatosPdfFactura, p: PaletaPdf): Content {
  const lista = movimientos(d);

  const titulo: Content = {
    text: "MOVIMIENTOS DEL PERÍODO",
    font: "InterSemi",
    fontSize: 8,
    characterSpacing: 1,
    color: p.primario,
    margin: [0, 22, 0, 8],
  };

  if (lista.length === 0) {
    return [
      titulo,
      {
        text: "Todavía no hay compras ni pagos en esta factura.",
        color: color.textoSuave,
      },
    ];
  }

  const encabezado = (texto: string, derecha = false): TableCell => ({
    text: texto,
    font: "InterSemi",
    fontSize: 8,
    color: color.textoSuave,
    fillColor: p.panel,
    alignment: derecha ? "right" : "left",
  });

  const cuerpo: TableCell[][] = [
    [
      encabezado("Fecha"),
      encabezado("Movimiento"),
      encabezado("Suma", true),
      encabezado("Resta", true),
      encabezado("Saldo", true),
    ],
  ];

  let saldo = 0;
  for (const m of lista) {
    saldo += (m.suma ?? 0) - (m.resta ?? 0);
    cuerpo.push([
      {
        stack: [
          { text: formatearFechaCorta(m.fecha), color: color.textoSuave },
          { text: m.tipo, fontSize: 7, color: color.textoTenue },
        ],
      },
      m.detalle,
      {
        text:
          m.suma === undefined ? "" : m.suma > 0 ? formatearPesos(m.suma) : "—",
        alignment: "right",
      },
      {
        text: m.resta === undefined ? "" : menos(m.resta),
        alignment: "right",
        color: p.secundario,
      },
      { text: formatearPesos(saldo), alignment: "right", font: "InterSemi" },
    ]);
  }

  const f = d.factura;
  cuerpo.push([
    { text: "" },
    { text: f.saldo > 0 ? "Saldo a pagar" : "Saldo", bold: true, fontSize: 10 },
    {
      text: formatearPesos(f.totalFiado),
      bold: true,
      fontSize: 10,
      alignment: "right",
    },
    {
      text: menos(f.totalPagos),
      bold: true,
      fontSize: 10,
      alignment: "right",
      color: p.secundario,
    },
    {
      text: formatearPesos(f.saldo),
      bold: true,
      fontSize: 10,
      alignment: "right",
      color: p.primario,
    },
  ]);

  const ultima = cuerpo.length - 1;

  return [
    titulo,
    {
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [44, "*", 62, 62, 66],
        body: cuerpo,
      },
      layout: {
        // Sin línea arriba ni abajo del encabezado; una fina entre renglones y
        // una más gruesa, del color de la marca, arriba del total.
        hLineWidth: (i: number, nodo: ContentTable) => {
          const filas = nodo.table.body.length;
          if (i <= 1 || i === filas) return 0;
          return i === filas - 1 ? 1.2 : 0.6;
        },
        hLineColor: (i: number, nodo: ContentTable) =>
          i === nodo.table.body.length - 1 ? p.primario : color.borde,
        vLineWidth: () => 0,
        paddingLeft: () => 6,
        paddingRight: () => 6,
        paddingTop: (i: number) => (i === ultima ? 7 : 5),
        paddingBottom: () => 5,
      },
    },
    {
      text: "En cada compra, “Suma” es lo que quedó anotado: el total menos lo que dejaste en el momento.",
      fontSize: 7.5,
      color: color.textoTenue,
      margin: [0, 8, 0, 0],
    },
  ];
}

export function documentoFactura(d: DatosPdfFactura): TDocumentDefinitions {
  const numero = numeroFactura(d.factura.numero);
  const generado = formatearFechaHora(d.generadoEl);
  const p = paletaPdf(d.marca);

  return {
    pageSize: "A4",
    pageMargins: [40, 40, 40, 60],
    info: {
      title: `${numero ? `Factura ${numero}` : "Factura en curso"} · ${d.cliente.nombre}`,
      author: d.marca.nombre,
      subject: "Resumen de cuenta",
      creator: d.marca.nombre,
    },
    defaultStyle: {
      font: "Inter",
      fontSize: 9,
      color: color.tinta,
      lineHeight: 1.15,
    },
    ...(d.factura.estado === "anulada" && {
      watermark: {
        text: "ANULADA",
        color: color.textoTenue,
        opacity: 0.12,
        bold: true,
      },
    }),
    content: [cabecera(d, p), heroe(d, p), tablaMovimientos(d, p)],
    footer: (pagina: number, total: number): Content => ({
      columns: [
        // Sin marca de la app: el PDF es del usuario, de punta a punta.
        { width: "*", text: `Generado el ${generado}` },
        {
          width: "auto",
          text: "Documento no válido como factura",
          alignment: "center",
        },
        {
          width: "*",
          text: `Página ${pagina} de ${total}`,
          alignment: "right",
        },
      ],
      margin: [40, 18, 40, 0],
      fontSize: 7.5,
      color: color.textoTenue,
    }),
  };
}
