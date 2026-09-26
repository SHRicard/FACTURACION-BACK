// Llena la base de desarrollo con datos que simulan la app en uso real:
// ~9 meses de historia de 10 negocios (kioscos, almacenes, tiendas de ropa,
// calzado, bebé, ferretería, deportes), con sus dueños, clientes, tickets,
// pagos, facturas saldadas y vencidas, cuentas a mitad del onboarding, una
// cuenta suspendida y errores reportados por la app.
//
//   npx tsx scripts/sembrar-demo.ts            borra la demo anterior y siembra de nuevo
//   npx tsx scripts/sembrar-demo.ts --limpiar  solo borra la demo
//
// Todo lo sembrado cuelga de cuentas con email @example.com (dominio reservado:
// ningún mail sale a una persona real). Lo demás de la base no se toca. Los
// teléfonos de los clientes empiezan con 1100: no existen, así que un
// "enviar por WhatsApp" no le llega a nadie.
//
// Todas las cuentas demo con contraseña entran con: demo1234
//
// Es determinístico: la misma semilla da los mismos datos (salvo las fechas,
// que se arman hacia atrás desde hoy). No corre con NODE_ENV=production.
import "dotenv/config";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose, { Types, type Model } from "mongoose";
import Usuario from "../src/models/Usuario.js";
import Marca from "../src/models/Marca.js";
import Cliente from "../src/models/Cliente.js";
import Especie from "../src/models/Especie.js";
import Factura from "../src/models/Factura.js";
import Ticket from "../src/models/Ticket.js";
import Pago from "../src/models/Pago.js";
import Producto from "../src/models/Producto.js";
import ErrorCliente from "../src/models/ErrorCliente.js";
import Dispositivo from "../src/models/Dispositivo.js";
import { recalcularMarca } from "../src/services/marcas.js";
import { recalcularFactura } from "../src/services/facturacion.js";
import { calcularCumplimiento } from "../src/services/cumplimiento.js";
import { diaEnZona, inicioDelDiaEnZona, proximoVencimiento, type VentanaPago } from "../src/utils/fechas.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../src/legal/documentos.js";

const DOMINIO_DEMO = "@example.com";
const PASSWORD_DEMO = "demo1234";
const DIA_MS = 86_400_000;

// ─────────────────────────────────────────────────────────────
// Azar reproducible

let semilla = 20260924;
function azar(): number {
  semilla |= 0;
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const entre = (min: number, max: number): number => Math.floor(azar() * (max - min + 1)) + min;
const uno = <T>(lista: readonly T[]): T => lista[Math.floor(azar() * lista.length)]!;
const chance = (p: number): boolean => azar() < p;
const redondearA = (n: number, paso: number): number => Math.max(paso, Math.round(n / paso) * paso);
const pesos = (n: number): number => Math.round(n * 100) / 100;

// ─────────────────────────────────────────────────────────────
// Fechas (en hora de Argentina)

const AHORA = new Date();
const HOY = diaEnZona(AHORA);

/** 00:00 del día que está `dias` antes de hoy. */
const inicioHaceDias = (dias: number): Date => inicioDelDiaEnZona(HOY.anio, HOY.mes, HOY.dia - dias);

/** Una hora de atención (9 a 21 hs) dentro de ese día, nunca en el futuro. */
function enHorario(inicioDia: Date, desde = 9, hasta = 21): Date {
  const fecha = new Date(inicioDia.getTime() + entre(desde * 60, hasta * 60) * 60_000);
  return fecha > AHORA ? new Date(AHORA.getTime() - entre(5, 90) * 60_000) : fecha;
}

const haceDias = (dias: number, horas = 0): Date => new Date(AHORA.getTime() - dias * DIA_MS - horas * 3_600_000);

// ─────────────────────────────────────────────────────────────
// Catálogos por rubro: lo que el kiosquero escribiría en el ticket

type Articulo = { nombre: string; especie: string; precio: number; talles?: readonly string[] };
type Rubro = {
  especies: readonly [string, string][];
  articulos: readonly Articulo[];
  /** Probabilidad de que un cliente compre un día cualquiera. */
  compraPorDia: number;
  renglones: [number, number];
  cantidad: [number, number];
  redondeo: number;
  ventanas: readonly VentanaPago[];
};

const TALLES_ROPA = ["S", "M", "L", "XL", "XXL"] as const;
const TALLES_JEAN = ["36", "38", "40", "42", "44", "46"] as const;
const TALLES_CALZADO = ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44"] as const;
const TALLES_BEBE = ["RN", "1", "3", "6", "9", "12", "18"] as const;

const ALMACEN: Rubro = {
  especies: [
    ["Almacén", "Fideos, arroz, harina, aceite, yerba"],
    ["Bebidas", "Gaseosas, aguas, jugos y cerveza"],
    ["Lácteos", "Leche, yogur, queso, manteca"],
    ["Panadería", "Pan, facturas y galletitas"],
    ["Fiambrería", "Jamón, queso, salame"],
    ["Golosinas", "Alfajores, chocolates, caramelos"],
    ["Limpieza", "Lavandina, detergente, jabón"],
  ],
  articulos: [
    { nombre: "Leche entera 1L", especie: "Lácteos", precio: 1350 },
    { nombre: "Yogur bebible 1L", especie: "Lácteos", precio: 2100 },
    { nombre: "Queso cremoso 250g", especie: "Lácteos", precio: 3100 },
    { nombre: "Manteca 200g", especie: "Lácteos", precio: 2300 },
    { nombre: "Fideos tirabuzón 500g", especie: "Almacén", precio: 1250 },
    { nombre: "Arroz largo fino 1kg", especie: "Almacén", precio: 1650 },
    { nombre: "Puré de tomate 520g", especie: "Almacén", precio: 900 },
    { nombre: "Yerba mate 1kg", especie: "Almacén", precio: 4400 },
    { nombre: "Azúcar 1kg", especie: "Almacén", precio: 1250 },
    { nombre: "Aceite girasol 1,5L", especie: "Almacén", precio: 3700 },
    { nombre: "Harina 000 1kg", especie: "Almacén", precio: 950 },
    { nombre: "Huevos x12", especie: "Almacén", precio: 3600 },
    { nombre: "Coca-Cola 2,25L", especie: "Bebidas", precio: 3800 },
    { nombre: "Agua mineral 2L", especie: "Bebidas", precio: 1150 },
    { nombre: "Jugo en polvo x5", especie: "Bebidas", precio: 1500 },
    { nombre: "Cerveza 1L retornable", especie: "Bebidas", precio: 2500 },
    { nombre: "Pan francés 1kg", especie: "Panadería", precio: 2400 },
    { nombre: "Facturas x6", especie: "Panadería", precio: 3500 },
    { nombre: "Galletitas de agua", especie: "Panadería", precio: 1100 },
    { nombre: "Jamón cocido 200g", especie: "Fiambrería", precio: 2900 },
    { nombre: "Salame 150g", especie: "Fiambrería", precio: 2700 },
    { nombre: "Alfajor triple", especie: "Golosinas", precio: 850 },
    { nombre: "Chocolate 100g", especie: "Golosinas", precio: 2200 },
    { nombre: "Caramelos surtidos", especie: "Golosinas", precio: 600 },
    { nombre: "Lavandina 1L", especie: "Limpieza", precio: 1050 },
    { nombre: "Detergente 750ml", especie: "Limpieza", precio: 1600 },
    { nombre: "Jabón en polvo 800g", especie: "Limpieza", precio: 3900 },
  ],
  compraPorDia: 0.2,
  renglones: [1, 5],
  cantidad: [1, 3],
  redondeo: 10,
  ventanas: [
    { desdeDia: 1, hastaDia: 10 },
    { desdeDia: 1, hastaDia: 10 },
    { desdeDia: 1, hastaDia: 5 },
    { desdeDia: 15, hastaDia: 20 },
  ],
};

const ROPA: Rubro = {
  especies: [
    ["Pantalón", "Jeans, joggings, de vestir"],
    ["Pantalón corto", "Shorts y bermudas"],
    ["Remera", "Manga corta, larga y musculosas"],
    ["Camisa", "De vestir y leñadoras"],
    ["Buzo", "Con y sin capucha"],
    ["Campera", "Abrigos, rompevientos e inflables"],
    ["Ropa interior", "Ropa interior y pijamas"],
    ["Media", "Cortas, largas y deportivas"],
  ],
  articulos: [
    { nombre: "Jean chupín", especie: "Pantalón", precio: 27000, talles: TALLES_JEAN },
    { nombre: "Jean mom", especie: "Pantalón", precio: 29500, talles: TALLES_JEAN },
    { nombre: "Jogging frisa", especie: "Pantalón", precio: 17500, talles: TALLES_ROPA },
    { nombre: "Calza deportiva", especie: "Pantalón", precio: 13500, talles: TALLES_ROPA },
    { nombre: "Bermuda de gabardina", especie: "Pantalón corto", precio: 16000, talles: TALLES_JEAN },
    { nombre: "Short de baño", especie: "Pantalón corto", precio: 11500, talles: TALLES_ROPA },
    { nombre: "Remera lisa algodón", especie: "Remera", precio: 8500, talles: TALLES_ROPA },
    { nombre: "Remera estampada", especie: "Remera", precio: 10500, talles: TALLES_ROPA },
    { nombre: "Musculosa", especie: "Remera", precio: 6500, talles: TALLES_ROPA },
    { nombre: "Camisa leñadora", especie: "Camisa", precio: 19500, talles: TALLES_ROPA },
    { nombre: "Camisa de vestir", especie: "Camisa", precio: 23000, talles: TALLES_ROPA },
    { nombre: "Buzo canguro", especie: "Buzo", precio: 21500, talles: TALLES_ROPA },
    { nombre: "Buzo cuello redondo", especie: "Buzo", precio: 18000, talles: TALLES_ROPA },
    { nombre: "Campera inflable", especie: "Campera", precio: 54000, talles: TALLES_ROPA },
    { nombre: "Campera de jean", especie: "Campera", precio: 42000, talles: TALLES_ROPA },
    { nombre: "Rompevientos", especie: "Campera", precio: 26000, talles: TALLES_ROPA },
    { nombre: "Boxer x3", especie: "Ropa interior", precio: 8900, talles: TALLES_ROPA },
    { nombre: "Pijama de invierno", especie: "Ropa interior", precio: 19000, talles: TALLES_ROPA },
    { nombre: "Medias x3", especie: "Media", precio: 4300 },
  ],
  compraPorDia: 0.035,
  renglones: [1, 3],
  cantidad: [1, 2],
  redondeo: 500,
  ventanas: [
    { desdeDia: 1, hastaDia: 10 },
    { desdeDia: 5, hastaDia: 15 },
    { desdeDia: 20, hastaDia: 28 },
  ],
};

const CALZADO: Rubro = {
  especies: [
    ["Zapatilla", "Deportivas y urbanas"],
    ["Zapato", "De vestir y mocasines"],
    ["Sandalia", "Sandalias y ojotas"],
    ["Bota", "Botas y borceguíes"],
    ["Media", "Cortas, largas y deportivas"],
  ],
  articulos: [
    { nombre: "Zapatilla running", especie: "Zapatilla", precio: 62000, talles: TALLES_CALZADO },
    { nombre: "Zapatilla urbana lona", especie: "Zapatilla", precio: 35000, talles: TALLES_CALZADO },
    { nombre: "Zapatilla escolar", especie: "Zapatilla", precio: 29000, talles: TALLES_CALZADO },
    { nombre: "Mocasín de cuero", especie: "Zapato", precio: 58000, talles: TALLES_CALZADO },
    { nombre: "Zapato de vestir", especie: "Zapato", precio: 64000, talles: TALLES_CALZADO },
    { nombre: "Sandalia con plataforma", especie: "Sandalia", precio: 31000, talles: TALLES_CALZADO },
    { nombre: "Ojotas", especie: "Sandalia", precio: 9500, talles: TALLES_CALZADO },
    { nombre: "Borceguí", especie: "Bota", precio: 71000, talles: TALLES_CALZADO },
    { nombre: "Bota de lluvia", especie: "Bota", precio: 26000, talles: TALLES_CALZADO },
    { nombre: "Medias deportivas x3", especie: "Media", precio: 5200 },
  ],
  compraPorDia: 0.022,
  renglones: [1, 2],
  cantidad: [1, 1],
  redondeo: 500,
  ventanas: [
    { desdeDia: 1, hastaDia: 10 },
    { desdeDia: 10, hastaDia: 20 },
  ],
};

const BEBE: Rubro = {
  especies: [
    ["Body", "Bodies manga corta y larga"],
    ["Enterito", "Enteritos y ositos"],
    ["Conjunto", "Conjuntos de dos o tres piezas"],
    ["Pañales", "Pañales y toallitas"],
    ["Accesorios", "Baberos, gorritos, mantas"],
  ],
  articulos: [
    { nombre: "Body algodón x2", especie: "Body", precio: 9800, talles: TALLES_BEBE },
    { nombre: "Body manga larga", especie: "Body", precio: 6200, talles: TALLES_BEBE },
    { nombre: "Enterito polar", especie: "Enterito", precio: 15500, talles: TALLES_BEBE },
    { nombre: "Osito de plush", especie: "Enterito", precio: 17000, talles: TALLES_BEBE },
    { nombre: "Conjunto jogging", especie: "Conjunto", precio: 18500, talles: TALLES_BEBE },
    { nombre: "Conjunto 3 piezas", especie: "Conjunto", precio: 22000, talles: TALLES_BEBE },
    { nombre: "Pañales x50", especie: "Pañales", precio: 16500, talles: ["P", "M", "G", "XG", "XXG"] },
    { nombre: "Toallitas húmedas x80", especie: "Pañales", precio: 3900 },
    { nombre: "Babero impermeable", especie: "Accesorios", precio: 3500 },
    { nombre: "Manta de algodón", especie: "Accesorios", precio: 12500 },
  ],
  compraPorDia: 0.05,
  renglones: [1, 3],
  cantidad: [1, 2],
  redondeo: 100,
  ventanas: [
    { desdeDia: 1, hastaDia: 10 },
    { desdeDia: 5, hastaDia: 12 },
  ],
};

const FERRETERIA: Rubro = {
  especies: [
    ["Herramientas", "Manuales y eléctricas"],
    ["Electricidad", "Cables, lámparas, enchufes"],
    ["Plomería", "Caños, llaves, conexiones"],
    ["Pinturería", "Pinturas, pinceles, rodillos"],
    ["Bulonería", "Tornillos, tarugos, clavos"],
  ],
  articulos: [
    { nombre: "Martillo carpintero", especie: "Herramientas", precio: 11500 },
    { nombre: "Destornillador set x6", especie: "Herramientas", precio: 9800 },
    { nombre: "Taladro percutor 650W", especie: "Herramientas", precio: 68000 },
    { nombre: "Lámpara LED 12W", especie: "Electricidad", precio: 1900 },
    { nombre: "Cable unipolar 2,5mm (m)", especie: "Electricidad", precio: 850 },
    { nombre: "Zapatilla eléctrica 5 tomas", especie: "Electricidad", precio: 8900 },
    { nombre: "Llave de paso 1/2", especie: "Plomería", precio: 7400 },
    { nombre: "Cinta teflón", especie: "Plomería", precio: 900 },
    { nombre: "Látex interior 4L", especie: "Pinturería", precio: 23000 },
    { nombre: "Rodillo lana 22cm", especie: "Pinturería", precio: 6500 },
    { nombre: "Tornillos + tarugos x50", especie: "Bulonería", precio: 3200 },
  ],
  compraPorDia: 0.04,
  renglones: [1, 3],
  cantidad: [1, 4],
  redondeo: 100,
  ventanas: [{ desdeDia: 1, hastaDia: 10 }],
};

const DEPORTES: Rubro = {
  especies: [
    ["Camiseta", "Camisetas de fútbol y entrenamiento"],
    ["Botines", "Botines de campo y futsal"],
    ["Short", "Shorts deportivos"],
    ["Pelota", "Pelotas de fútbol y vóley"],
    ["Media", "Medias de fútbol"],
  ],
  articulos: [
    { nombre: "Camiseta alternativa", especie: "Camiseta", precio: 45000, talles: TALLES_ROPA },
    { nombre: "Camiseta entrenamiento", especie: "Camiseta", precio: 19000, talles: TALLES_ROPA },
    { nombre: "Botines césped natural", especie: "Botines", precio: 72000, talles: TALLES_CALZADO },
    { nombre: "Botines futsal", especie: "Botines", precio: 48000, talles: TALLES_CALZADO },
    { nombre: "Short de fútbol", especie: "Short", precio: 12000, talles: TALLES_ROPA },
    { nombre: "Pelota N°5", especie: "Pelota", precio: 28000 },
    { nombre: "Medias de fútbol", especie: "Media", precio: 6500 },
  ],
  compraPorDia: 0.08,
  renglones: [1, 2],
  cantidad: [1, 1],
  redondeo: 500,
  ventanas: [{ desdeDia: 1, hastaDia: 10 }],
};

// ─────────────────────────────────────────────────────────────
// Los negocios y sus dueños

type Dueno = {
  nombre: string;
  email: string;
  google?: boolean;
  /** Días desde que se sumó, si no es el creador. */
  sumadoHace?: number;
  /** Aceptó una versión vieja de los términos y no volvió a entrar. */
  terminosViejos?: boolean;
  /** Días desde su último acceso. */
  ultimoAccesoHace: number;
  version?: string;
};

type Negocio = {
  nombre: string;
  direccion: string;
  telefono: string;
  colores?: [string, string];
  rubro: Rubro;
  /** Días desde que se creó la marca. */
  creadaHace: number;
  /** Días desde que dejó de usar la app (0 = la usa hoy). */
  sinUsoHace?: number;
  clientes: number;
  duenos: Dueno[];
};

const NEGOCIOS: Negocio[] = [
  {
    nombre: "Kiosco Don Tito",
    direccion: "Av. San Martín 1450, Lanús",
    telefono: "11 4241-0000",
    colores: ["#1e3a8a", "#f59e0b"],
    rubro: ALMACEN,
    creadaHace: 255,
    clientes: 34,
    duenos: [
      { nombre: "Héctor Gómez", email: "tito.gomez", ultimoAccesoHace: 0, version: "1.4.0" },
      { nombre: "Marta Ruiz", email: "marta.ruiz", google: true, sumadoHace: 240, ultimoAccesoHace: 1, version: "1.4.0" },
    ],
  },
  {
    nombre: "Almacén La Esquina",
    direccion: "Belgrano 322, Quilmes",
    telefono: "11 4253-0000",
    rubro: ALMACEN,
    creadaHace: 230,
    clientes: 26,
    duenos: [{ nombre: "Graciela Fernández", email: "graciela.fernandez", ultimoAccesoHace: 0, version: "1.3.2" }],
  },
  {
    nombre: "Morena Indumentaria",
    direccion: "Av. Rivadavia 8890, Floresta",
    telefono: "11 4671-0000",
    colores: ["#4a1866", "#f2c14e"],
    rubro: ROPA,
    creadaHace: 245,
    clientes: 28,
    duenos: [
      { nombre: "Morena Díaz", email: "morena.diaz", google: true, ultimoAccesoHace: 0, version: "1.4.0" },
      { nombre: "Julián Díaz", email: "julian.diaz", sumadoHace: 200, terminosViejos: true, ultimoAccesoHace: 21, version: "1.3.2" },
    ],
  },
  {
    nombre: "Calzados Pasito",
    direccion: "Mitre 1020, Avellaneda",
    telefono: "11 4201-0000",
    rubro: CALZADO,
    creadaHace: 190,
    clientes: 18,
    duenos: [{ nombre: "Ricardo Pérez", email: "ricardo.perez", ultimoAccesoHace: 2, version: "1.4.0" }],
  },
  {
    nombre: "Mundo Bebé Rocío",
    direccion: "Calle 7 N° 845, La Plata",
    telefono: "221 421-0000",
    colores: ["#db2777", "#7dd3fc"],
    rubro: BEBE,
    creadaHace: 170,
    clientes: 22,
    duenos: [{ nombre: "Rocío Benítez", email: "rocio.benitez", google: true, ultimoAccesoHace: 0, version: "1.4.0" }],
  },
  {
    nombre: "Autoservicio El Pampa",
    direccion: "Ruta 3 km 32, González Catán",
    telefono: "11 4485-0000",
    rubro: ALMACEN,
    creadaHace: 205,
    clientes: 30,
    duenos: [
      { nombre: "Walter Acosta", email: "walter.acosta", ultimoAccesoHace: 0, version: "1.2.0" },
      { nombre: "Silvia Acosta", email: "silvia.acosta", sumadoHace: 205, ultimoAccesoHace: 3, version: "1.4.0" },
    ],
  },
  {
    nombre: "Tienda Sofía",
    direccion: "Sarmiento 455, Morón",
    telefono: "11 4629-0000",
    rubro: ROPA,
    creadaHace: 120,
    clientes: 20,
    duenos: [{ nombre: "Sofía Romero", email: "sofia.romero", google: true, ultimoAccesoHace: 1, version: "1.4.0" }],
  },
  {
    nombre: "Kiosco 24 Hs Lucas",
    direccion: "Av. Mosconi 2210, Villa Devoto",
    telefono: "11 4501-0000",
    rubro: ALMACEN,
    creadaHace: 200,
    sinUsoHace: 48,
    clientes: 15,
    duenos: [{ nombre: "Lucas Medina", email: "lucas.medina", ultimoAccesoHace: 48, version: "1.2.0" }],
  },
  {
    nombre: "Ferretería Los Hermanos",
    direccion: "Av. Hipólito Yrigoyen 3300, Lomas de Zamora",
    telefono: "11 4244-0000",
    rubro: FERRETERIA,
    creadaHace: 95,
    clientes: 12,
    duenos: [
      { nombre: "Diego Sosa", email: "diego.sosa", ultimoAccesoHace: 4, version: "1.3.2" },
      { nombre: "Pablo Sosa", email: "pablo.sosa", sumadoHace: 60, ultimoAccesoHace: 9, version: "1.3.2" },
    ],
  },
  {
    nombre: "Deportes Gol",
    direccion: "Av. Maipú 1600, Vicente López",
    telefono: "11 4791-0000",
    colores: ["#15803d", "#facc15"],
    rubro: DEPORTES,
    creadaHace: 16,
    clientes: 9,
    duenos: [{ nombre: "Matías Herrera", email: "matias.herrera", google: true, ultimoAccesoHace: 0, version: "1.4.0" }],
  },
];

/** Cuentas que no llegaron a operar: cada una trabada en un paso del onboarding. */
type CuentaSuelta = {
  nombre: string;
  email: string;
  google?: boolean;
  creadaHace: number;
  paso: "terminos" | "perfil" | "marca" | "suspendida";
  ultimoAccesoHace?: number;
  version?: string;
};

const CUENTAS_SUELTAS: CuentaSuelta[] = [
  { nombre: "Nicolás Castro", email: "nico.castro", creadaHace: 70, paso: "terminos", ultimoAccesoHace: 40, version: "1.3.2" },
  { nombre: "Camila Ortiz", email: "camila.ortiz", google: true, creadaHace: 5, paso: "perfil", ultimoAccesoHace: 5, version: "1.4.0" },
  { nombre: "Federico Luna", email: "fede.luna", creadaHace: 2, paso: "perfil", ultimoAccesoHace: 2, version: "1.4.0" },
  { nombre: "Valentina Ríos", email: "valen.rios", creadaHace: 0, paso: "perfil", ultimoAccesoHace: 0, version: "1.4.0" },
  { nombre: "Agustina Molina", email: "agustina.molina", creadaHace: 34, paso: "marca", ultimoAccesoHace: 30, version: "1.3.2" },
  { nombre: "Gustavo Rojas", email: "gustavo.rojas", google: true, creadaHace: 12, paso: "marca", ultimoAccesoHace: 11, version: "1.4.0" },
  { nombre: "Paula Vega", email: "paula.vega", creadaHace: 6, paso: "marca", ultimoAccesoHace: 1, version: "1.4.0" },
  { nombre: "Promo Ventas", email: "promo.ventas", creadaHace: 25, paso: "suspendida", ultimoAccesoHace: 24, version: "1.4.0" },
];

// ─────────────────────────────────────────────────────────────
// Clientes

const NOMBRES = [
  "María", "José", "Ana", "Carlos", "Laura", "Jorge", "Silvina", "Marcelo", "Patricia", "Daniel",
  "Mónica", "Sergio", "Claudia", "Roberto", "Verónica", "Luis", "Andrea", "Miguel", "Gabriela", "Oscar",
  "Lorena", "Raúl", "Natalia", "Hugo", "Florencia", "Ramón", "Carolina", "Alberto", "Romina", "Fernando",
  "Soledad", "Eduardo", "Mariela", "Cristian", "Noelia", "Ezequiel", "Yanina", "Gonzalo", "Micaela", "Brian",
  "Rosa", "Juan Carlos", "Norma", "Ángel", "Beatriz", "Rubén", "Estela", "Leandro", "Susana", "Damián",
] as const;
const APELLIDOS = [
  "González", "Rodríguez", "Gómez", "Fernández", "López", "Díaz", "Martínez", "Pérez", "García", "Sánchez",
  "Romero", "Sosa", "Álvarez", "Torres", "Ruiz", "Ramírez", "Flores", "Acosta", "Benítez", "Medina",
  "Herrera", "Suárez", "Aguirre", "Giménez", "Gutiérrez", "Pereyra", "Rojas", "Molina", "Castro", "Ortiz",
  "Silva", "Núñez", "Luna", "Juárez", "Cabrera", "Ríos", "Ferreyra", "Godoy", "Morales", "Domínguez",
] as const;
const CALLES = [
  "Belgrano", "San Martín", "Moreno", "Rivadavia", "Mitre", "Sarmiento", "Alsina", "Pueyrredón",
  "Lavalle", "Castelli", "Brown", "French", "Las Heras", "Güemes", "Colón", "9 de Julio",
] as const;

/**
 * Cómo se porta cada cliente con la libreta:
 *   puntual   → paga todo dentro de su ventana
 *   tardio    → paga todo, pero una o tres semanas tarde (a veces pide otra fecha)
 *   moroso    → entrega de a poco y arrastra deuda
 *   ocasional → compra poco y paga cuando se acuerda
 */
type Perfil = "puntual" | "tardio" | "moroso" | "ocasional";
const PERFILES: [Perfil, number][] = [
  ["puntual", 0.42],
  ["tardio", 0.3],
  ["moroso", 0.14],
  ["ocasional", 0.14],
];
function perfilAlAzar(): Perfil {
  let r = azar();
  for (const [perfil, peso] of PERFILES) {
    if ((r -= peso) < 0) return perfil;
  }
  return "puntual";
}

const METODOS = ["efectivo", "efectivo", "efectivo", "transferencia", "transferencia", "mercadopago", "otro"] as const;
const NOTAS_PAGO = ["Pagó la hija", "Dejó a cuenta", "Cobro del aguinaldo", "Transferencia desde cuenta del marido", "Dijo que el resto a fin de mes"];

// ─────────────────────────────────────────────────────────────
// Lo que se va a insertar

type Doc = Record<string, unknown>;
const lote = {
  usuarios: [] as Doc[],
  marcas: [] as Doc[],
  especies: [] as Doc[],
  clientes: [] as Doc[],
  facturas: [] as Doc[],
  tickets: [] as Doc[],
  pagos: [] as Doc[],
  errores: [] as Doc[],
};

/**
 * Pasa el documento por el schema (defaults y validaciones, igual que la app)
 * y le pone las fechas a mano: se inserta crudo para que createdAt sea la
 * fecha simulada y no la de hoy.
 */
function armar(modelo: Model<any>, datos: Doc, creado: Date, actualizado = creado): Doc {
  const doc = new modelo(datos);
  const error = doc.validateSync();
  if (error) throw new Error(`${modelo.modelName} inválido: ${error.message}\n${JSON.stringify(datos)}`);
  return { ...doc.toObject({ virtuals: false }), createdAt: creado, updatedAt: actualizado };
}

const dnisUsados = new Set<string>();
function dniNuevo(desde: number, hasta: number): string {
  for (;;) {
    const dni = String(entre(desde, hasta));
    if (!dnisUsados.has(dni)) {
      dnisUsados.add(dni);
      return dni;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Usuarios

let hashDemo = "";

function armarUsuario(
  u: { nombre: string; email: string; google?: boolean },
  creado: Date,
  extra: Doc
): Doc & { _id: Types.ObjectId } {
  const _id = new Types.ObjectId();
  const email = `${u.email}${DOMINIO_DEMO}`;
  const iniciales = encodeURIComponent(u.nombre);
  const identidad: Doc = u.google
    ? {
        proveedor: "google",
        googleId: `demo-${createHash("sha1").update(email).digest("hex").slice(0, 20)}`,
        avatar: `https://ui-avatars.com/api/?name=${iniciales}&background=random`,
      }
    : { proveedor: "local", password: hashDemo };

  const doc = armar(
    Usuario,
    {
      _id,
      nombre: u.nombre,
      email,
      rol: "administrador",
      aceptoTerminosYCondiciones: true,
      terminosYCondicionesVersion: VERSION_DOCUMENTOS_LEGALES,
      terminosYCondicionesAceptadosEn: creado,
      ...identidad,
      ...extra,
    },
    creado,
    extra["ultimoAcceso"] instanceof Date ? (extra["ultimoAcceso"] as Date) : creado
  );
  // El password ya va hasheado: el hook de save no corre en un insert crudo.
  if (!u.google) doc["password"] = hashDemo;
  lote.usuarios.push(doc);
  return doc as Doc & { _id: Types.ObjectId };
}

// ─────────────────────────────────────────────────────────────
// La simulación de un negocio

type FacturaSim = {
  _id: Types.ObjectId;
  desde: Date;
  venceEl: Date;
  vencimientoOriginal: Date;
  reprogramadaEl?: Date;
  pagadaEl?: Date;
  creada: Date;
  tickets: Doc[];
  pagos: Doc[];
  saldo: number;
  cerrada: boolean;
};

/** Cuánto aumentan los precios por mes: la inflación también se simula. */
const INFLACION_MENSUAL = 0.022;

function precioDelDia(base: number, fecha: Date, redondeo: number): number {
  const mesesAtras = (AHORA.getTime() - fecha.getTime()) / (30 * DIA_MS);
  return redondearA(base / Math.pow(1 + INFLACION_MENSUAL, mesesAtras), redondeo);
}

function simularNegocio(negocio: Negocio) {
  const creadaEl = enHorario(inicioHaceDias(negocio.creadaHace), 10, 19);
  const marcaId = new Types.ObjectId();

  // ── Dueños
  const duenos = negocio.duenos.map((d) => {
    const alta = d.sumadoHace !== undefined ? enHorario(inicioHaceDias(d.sumadoHace + entre(1, 6))) : new Date(creadaEl.getTime() - entre(10, 120) * 60_000);
    return armarUsuario(d, alta, {
      dni: dniNuevo(20_000_000, 42_000_000),
      marca: marcaId,
      ultimoAcceso: haceDias(d.ultimoAccesoHace, entre(0, 8)),
      ...(d.version && { ultimaVersionApp: d.version }),
      ...(d.terminosViejos && { terminosYCondicionesVersion: "2026-08-01" }),
    });
  });
  const creador = duenos[0]!;

  lote.marcas.push(
    armar(
      Marca,
      {
        _id: marcaId,
        nombre: negocio.nombre,
        direccion: negocio.direccion,
        telefono: negocio.telefono,
        ...(negocio.colores && { colorPrimario: negocio.colores[0], colorSecundario: negocio.colores[1] }),
        creadaPor: creador._id,
      },
      creadaEl
    )
  );

  // ── Especies
  const especies = new Map<string, Types.ObjectId>();
  for (const [nombre, descripcion] of negocio.rubro.especies) {
    const _id = new Types.ObjectId();
    especies.set(nombre, _id);
    lote.especies.push(armar(Especie, { _id, nombre, descripcion, activo: true, marca: marcaId }, new Date(creadaEl.getTime() + entre(5, 60) * 60_000)));
  }

  // ── Clientes
  const ultimoDiaDeUso = negocio.sinUsoHace ?? 0;
  const dnisClientes = new Set<string>();
  const nombresUsados = new Set<string>();
  let numeroDeFacturas = 0;
  const cerradas: { factura: Doc; pagadaEl: Date }[] = [];

  for (let i = 0; i < negocio.clientes; i++) {
    let nombre = "";
    do nombre = `${uno(NOMBRES)} ${uno(APELLIDOS)}`;
    while (nombresUsados.has(nombre));
    nombresUsados.add(nombre);

    let dni = "";
    do dni = String(entre(12_000_000, 46_000_000));
    while (dnisClientes.has(dni));
    dnisClientes.add(dni);

    const perfil = perfilAlAzar();
    // La mayoría se carga el primer mes (se pasa la libreta de papel a la app).
    const diasDesdeAlta = chance(0.6)
      ? negocio.creadaHace - entre(0, Math.min(30, negocio.creadaHace))
      : entre(ultimoDiaDeUso, negocio.creadaHace);
    const altaCliente = enHorario(inicioHaceDias(Math.max(ultimoDiaDeUso, diasDesdeAlta)));
    const ventanaPago = uno(negocio.rubro.ventanas);
    const clienteId = new Types.ObjectId();

    lote.clientes.push(
      armar(
        Cliente,
        {
          _id: clienteId,
          nombre,
          dni,
          ...(chance(0.85) && { telefono: `1100${entre(100000, 999999)}` }),
          ...(chance(0.25) && {
            email: `${nombre.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")}.${entre(10, 99)}${DOMINIO_DEMO}`,
          }),
          ...(chance(0.6) && { direccion: `${uno(CALLES)} ${entre(100, 3999)}` }),
          ventanaPago,
          limiteCredito: chance(0.3) ? redondearA(entre(3, 30) * 10_000, 10_000) : 0,
          marca: marcaId,
        },
        altaCliente
      )
    );

    // Cuándo deja de venir (algunos se van, y los morosos se van debiendo).
    const abandonaHace = chance(perfil === "moroso" ? 0.35 : 0.12) ? entre(ultimoDiaDeUso + 5, Math.max(ultimoDiaDeUso + 6, diasDesdeAlta - 20)) : null;
    const compraPorDia =
      negocio.rubro.compraPorDia * (perfil === "ocasional" ? 0.35 : 1) * (0.6 + azar() * 0.8);

    let actual: FacturaSim | null = null;
    const facturasCliente: FacturaSim[] = [];

    const abrir = (fecha: Date): FacturaSim => {
      const vence = proximoVencimiento(ventanaPago, fecha);
      const f: FacturaSim = {
        _id: new Types.ObjectId(),
        desde: fecha,
        venceEl: vence,
        vencimientoOriginal: vence,
        creada: fecha,
        tickets: [],
        pagos: [],
        saldo: 0,
        cerrada: false,
      };
      facturasCliente.push(f);
      return f;
    };

    const pagar = (f: FacturaSim, fecha: Date, monto: number) => {
      monto = pesos(Math.min(monto, f.saldo));
      if (monto <= 0) return;
      const quien = uno(duenos);
      const base: Doc = {
        factura: f._id,
        cliente: clienteId,
        marca: marcaId,
        fecha,
        monto,
        metodoPago: uno(METODOS),
        ...(chance(0.08) && { nota: uno(NOTAS_PAGO) }),
        registradoPor: quien._id,
      };

      // De vez en cuando se carga dos veces y se anula el repetido.
      if (chance(0.015)) {
        f.pagos.push(
          armar(Pago, { ...base, saldoAnterior: f.saldo, saldoPosterior: pesos(f.saldo - monto), anulado: true, anuladoEl: new Date(fecha.getTime() + 4 * 60_000), motivoAnulacion: "Cargado dos veces" }, fecha)
        );
      }

      f.pagos.push(armar(Pago, { ...base, saldoAnterior: f.saldo, saldoPosterior: pesos(f.saldo - monto) }, new Date(fecha.getTime() + 60_000)));
      f.saldo = pesos(f.saldo - monto);
      if (f.saldo <= 0) {
        f.cerrada = true;
        f.pagadaEl = fecha;
        actual = null;
      }
    };

    const diasDeHistoria = Math.floor((AHORA.getTime() - altaCliente.getTime()) / DIA_MS);
    for (let hace = diasDeHistoria; hace >= ultimoDiaDeUso; hace--) {
      const dia = inicioHaceDias(hace);
      const sigueViniendo = abandonaHace === null || hace > abandonaHace;

      // ── ¿Compra hoy?
      if (sigueViniendo && chance(compraPorDia)) {
        const fecha = enHorario(dia);
        if (fecha < altaCliente) continue;
        if (!actual) actual = abrir(fecha);
        const f: FacturaSim = actual;

        const items = Array.from({ length: entre(...negocio.rubro.renglones) }, () => {
          const art = uno(negocio.rubro.articulos);
          const cantidad = entre(...negocio.rubro.cantidad);
          const precioUnitario = precioDelDia(art.precio, fecha, negocio.rubro.redondeo);
          return {
            nombre: art.nombre,
            ...(art.talles && { talle: uno(art.talles) }),
            especie: especies.get(art.especie)!,
            especieNombre: art.especie,
            cantidad,
            precioUnitario,
            subtotal: pesos(cantidad * precioUnitario),
          };
        });
        const total = pesos(items.reduce((t, it) => t + it.subtotal, 0));

        // Lo que deja en el momento: casi siempre nada, a veces una parte.
        let pagado = 0;
        const r = azar();
        if (r < 0.08) pagado = total;
        else if (r < 0.3) pagado = Math.min(total, redondearA(total * (0.2 + azar() * 0.5), negocio.rubro.redondeo));

        const anulado = chance(0.02);
        f.tickets.push(
          armar(
            Ticket,
            {
              factura: f._id,
              cliente: clienteId,
              marca: marcaId,
              fecha,
              items,
              total,
              pagado,
              registradoPor: uno(duenos)._id,
              ...(anulado && {
                anulado: true,
                anuladoEl: new Date(fecha.getTime() + entre(2, 60) * 60_000),
                motivoAnulacion: uno(["Cargado dos veces", "Se equivocó de cliente", "Devolvió la mercadería", "Precio mal cargado"]),
              }),
            },
            fecha
          )
        );
        if (!anulado) f.saldo = pesos(f.saldo + total - pagado);
      }

      // ── ¿Paga hoy?
      const f = actual as FacturaSim | null;
      if (!f || f.saldo <= 0) continue;
      const diasAlVencimiento = Math.round((f.venceEl.getTime() - dia.getTime()) / DIA_MS);
      const largoVentana = ventanaPago.hastaDia - ventanaPago.desdeDia;
      const fechaPago = enHorario(dia);
      const ultimoTicket = f.tickets[f.tickets.length - 1];
      if (ultimoTicket && fechaPago < (ultimoTicket["fecha"] as Date)) continue;

      switch (perfil) {
        case "puntual":
          if (diasAlVencimiento <= largoVentana && chance(diasAlVencimiento < 0 ? 0.5 : 0.25)) {
            if (chance(0.15)) pagar(f, fechaPago, redondearA(f.saldo * 0.5, 100));
            else pagar(f, fechaPago, f.saldo);
          }
          break;
        case "tardio":
          // El día que vence, a veces pide otra fecha ("te pago el 25").
          if (diasAlVencimiento === 0 && !f.reprogramadaEl && chance(0.3)) {
            f.reprogramadaEl = fechaPago;
            f.venceEl = new Date(f.venceEl.getTime() + entre(7, 20) * DIA_MS);
          } else if (diasAlVencimiento < -3 && chance(0.1)) {
            pagar(f, fechaPago, f.saldo);
          } else if (chance(0.015)) {
            pagar(f, fechaPago, redondearA(f.saldo * (0.2 + azar() * 0.3), 100));
          }
          break;
        case "moroso":
          if (sigueViniendo && chance(0.035)) pagar(f, fechaPago, redondearA(f.saldo * (0.15 + azar() * 0.3), 100));
          else if (diasAlVencimiento < -45 && chance(0.012)) pagar(f, fechaPago, f.saldo);
          break;
        case "ocasional":
          if (diasAlVencimiento < 10 && chance(0.08)) pagar(f, fechaPago, f.saldo);
          break;
      }
    }

    // Nunca compró: la app le deja una factura vacía al darlo de alta.
    if (facturasCliente.length === 0) abrir(altaCliente);

    // ── A documentos, con los totales como los calcula recalcularFactura
    for (const f of facturasCliente) {
      const tickets = f.tickets.filter((t) => !t["anulado"]);
      const pagos = f.pagos.filter((p) => !p["anulado"]);
      const totalMercaderia = pesos(tickets.reduce((t, k) => t + (k["total"] as number), 0));
      const totalPagadoEnTickets = pesos(tickets.reduce((t, k) => t + (k["pagado"] as number), 0));
      const totalFiado = pesos(tickets.reduce((t, k) => t + Math.max((k["total"] as number) - (k["pagado"] as number), 0), 0));
      const totalPagos = pesos(pagos.reduce((t, p) => t + (p["monto"] as number), 0));
      const fechasPago = pagos.map((p) => (p["fecha"] as Date).getTime());
      const ultimoPagoEl = fechasPago.length ? new Date(Math.max(...fechasPago)) : null;
      const vacia = f.tickets.length === 0;

      const factura = armar(
        Factura,
        {
          _id: f._id,
          marca: marcaId,
          cliente: clienteId,
          estado: f.cerrada ? "pagada" : "abierta",
          desde: f.desde,
          venceEl: f.venceEl,
          ...(!vacia && { vencimientoOriginal: f.vencimientoOriginal }),
          ...(f.reprogramadaEl && { reprogramadaEl: f.reprogramadaEl }),
          ...(f.pagadaEl && { pagadaEl: f.pagadaEl }),
          cantidadTickets: tickets.length,
          totalMercaderia,
          totalPagadoEnTickets,
          totalFiado,
          totalPagos,
          cantidadPagos: pagos.length,
          ultimoPagoEl,
          saldo: pesos(totalFiado - totalPagos),
          cumplimiento: vacia ? null : calcularCumplimiento(totalFiado, pagos as { fecha: Date; monto: number }[], f.vencimientoOriginal),
        },
        f.creada,
        f.pagadaEl ?? ultimoPagoEl ?? f.creada
      );
      if (f.cerrada) cerradas.push({ factura, pagadaEl: f.pagadaEl! });
      lote.facturas.push(factura);
      lote.tickets.push(...f.tickets);
      lote.pagos.push(...f.pagos);
    }
  }

  // El número se pone al saldar: correlativo por marca, en el orden en que se saldaron.
  cerradas.sort((a, b) => a.pagadaEl.getTime() - b.pagadaEl.getTime());
  for (const { factura } of cerradas) factura["numero"] = ++numeroDeFacturas;

  return { marcaId, duenos };
}

// ─────────────────────────────────────────────────────────────
// Errores que reportó la app (K12). Solo de los últimos 30 días: Mongo borra
// los más viejos.

type GrupoError = {
  nombre: string;
  mensaje: string;
  frame: string;
  ruta: string;
  fatal: boolean;
  versiones: string[];
  plataformas: ("android" | "ios" | "web")[];
  veces: number;
  /** Hace cuántos días apareció por primera vez. */
  desdeHace: number;
  componentStack?: string;
};

const ERRORES: GrupoError[] = [
  { nombre: "Error", mensaje: "Network request failed", frame: "at fetch (node_modules/whatwg-fetch/dist/fetch.umd.js:535:18)", ruta: "/tickets/nuevo", fatal: false, versiones: ["1.4.0", "1.3.2"], plataformas: ["android", "ios"], veces: 34, desdeHace: 29 },
  { nombre: "TypeError", mensaje: "Cannot read property 'nombre' of undefined", frame: "at ClienteCabecera (app/clientes/[id].tsx:48:31)", ruta: "/clientes/[id]", fatal: false, versiones: ["1.3.2"], plataformas: ["android"], veces: 12, desdeHace: 26, componentStack: "\n    in ClienteCabecera\n    in ClienteScreen\n    in Stack" },
  { nombre: "RangeError", mensaje: "Invalid time value", frame: "at formatearFecha (src/utils/fechas.ts:22:10)", ruta: "/facturas/[id]", fatal: false, versiones: ["1.3.2", "1.4.0"], plataformas: ["android", "ios", "web"], veces: 9, desdeHace: 18 },
  { nombre: "TypeError", mensaje: "undefined is not a function (near '...items.map...')", frame: "at TicketResumen (src/components/tickets/TicketResumen.tsx:73:22)", ruta: "/tickets/nuevo", fatal: true, versiones: ["1.2.0"], plataformas: ["android"], veces: 7, desdeHace: 27 },
  { nombre: "Error", mensaje: "Rendered more hooks than during the previous render.", frame: "at updateWorkInProgressHook (node_modules/react/cjs/react.development.js:15688:13)", ruta: "/metricas", fatal: true, versiones: ["1.4.0"], plataformas: ["ios"], veces: 4, desdeHace: 3, componentStack: "\n    in GraficoEvolucion\n    in MetricasScreen" },
  { nombre: "SyntaxError", mensaje: "JSON Parse error: Unexpected character: <", frame: "at parseJSON (src/api/client.ts:61:25)", ruta: "/marca", fatal: false, versiones: ["1.4.0"], plataformas: ["web"], veces: 3, desdeHace: 8 },
];

const DISPOSITIVOS: Record<"android" | "ios" | "web", readonly (readonly [string, string])[]> = {
  android: [["Samsung Galaxy A14", "13"], ["Motorola Moto G32", "13"], ["Xiaomi Redmi Note 12", "14"], ["Samsung Galaxy A05s", "14"]],
  ios: [["iPhone 11", "17.5"], ["iPhone 13", "18.0"], ["iPhone SE", "17.6"]],
  web: [["Chrome 128", "Windows 11"], ["Safari 17", "macOS 14"]],
};

function sembrarErrores(usuarios: (Doc & { _id: Types.ObjectId })[]) {
  const conMarca = usuarios.filter((u) => u["marca"]);
  for (const g of ERRORES) {
    const stack = `${g.nombre}: ${g.mensaje}\n    ${g.frame}\n    at renderWithHooks (node_modules/react/cjs/react.development.js:14803:18)`;
    const huella = createHash("sha256").update(`${g.nombre}|${g.mensaje}|${g.frame}`).digest("hex");
    for (let i = 0; i < g.veces; i++) {
      const cuando = new Date(AHORA.getTime() - azar() * g.desdeHace * DIA_MS);
      const plataforma = uno(g.plataformas);
      const [dispositivo, versionSO] = uno(DISPOSITIVOS[plataforma]);
      const usuario = chance(0.85) ? uno(conMarca) : null;
      lote.errores.push(
        armar(
          ErrorCliente,
          {
            mensaje: g.mensaje,
            nombre: g.nombre,
            stack,
            ...(g.componentStack && { componentStack: g.componentStack }),
            ruta: g.ruta,
            fatal: g.fatal,
            version: uno(g.versiones),
            plataforma,
            versionSO,
            dispositivo,
            ocurridoEn: new Date(cuando.getTime() - entre(0, 30) * 1000),
            huella,
            ...(usuario && { usuario: usuario._id, marca: usuario["marca"] }),
          },
          cuando
        )
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Borrar la demo anterior

async function limpiarDemo(): Promise<void> {
  const demo = await Usuario.find({ email: { $regex: `${DOMINIO_DEMO.replace(".", "\\.")}$` } }).select("_id marca");
  const idsDemo = demo.map((u) => u._id);
  const marcasCandidatas = [
    ...new Set([
      ...demo.filter((u) => u.marca).map((u) => String(u.marca)),
      ...(await Marca.find({ creadaPor: { $in: idsDemo } }).distinct("_id")).map(String),
    ]),
  ];

  // Una marca que también tiene dueños de verdad no se toca.
  const marcas: Types.ObjectId[] = [];
  for (const id of marcasCandidatas) {
    const ajenos = await Usuario.countDocuments({ marca: id, _id: { $nin: idsDemo } });
    if (ajenos > 0) console.warn(`  ! la marca ${id} tiene dueños que no son demo: no se borra`);
    else marcas.push(new Types.ObjectId(id));
  }

  const filtro = { marca: { $in: marcas } };
  const borrados = {
    tickets: (await Ticket.deleteMany(filtro)).deletedCount,
    pagos: (await Pago.deleteMany(filtro)).deletedCount,
    facturas: (await Factura.deleteMany(filtro)).deletedCount,
    clientes: (await Cliente.deleteMany(filtro)).deletedCount,
    especies: (await Especie.deleteMany(filtro)).deletedCount,
    productos: (await Producto.deleteMany(filtro)).deletedCount,
    errores: (await ErrorCliente.deleteMany({ $or: [{ usuario: { $in: idsDemo } }, filtro] })).deletedCount,
    // Si alguien entró con una cuenta demo desde un teléfono, el teléfono queda anónimo.
    telefonos: (await Dispositivo.updateMany({ usuario: { $in: idsDemo } }, { $unset: { usuario: "" } })).modifiedCount,
    marcas: (await Marca.deleteMany({ _id: { $in: marcas } })).deletedCount,
    usuarios: (await Usuario.deleteMany({ _id: { $in: idsDemo } })).deletedCount,
  };
  console.log("Demo anterior borrada:", borrados);
}

// ─────────────────────────────────────────────────────────────

async function insertar(modelo: Model<any>, docs: Doc[]): Promise<void> {
  for (let i = 0; i < docs.length; i += 1000) {
    await modelo.collection.insertMany(docs.slice(i, i + 1000), { ordered: false });
  }
  console.log(`  ${modelo.collection.collectionName.padEnd(16)} ${docs.length}`);
}

async function main(): Promise<void> {
  if ((process.env["NODE_ENV"] ?? "").replace(/["']/g, "").trim() === "production") {
    throw new Error("No se siembran datos de demo con NODE_ENV=production");
  }
  const uri = process.env["MONGO_URI"];
  if (!uri) throw new Error("Falta MONGO_URI");

  await mongoose.connect(uri);
  console.log(`Base: ${mongoose.connection.name}`);
  // Los índices (únicos incluidos) tienen que existir antes de insertar.
  await Promise.all([Usuario, Marca, Cliente, Especie, Factura, Ticket, Pago, ErrorCliente].map((m) => m.init()));

  await limpiarDemo();
  if (process.argv.includes("--limpiar")) return;

  // Los DNI de las cuentas que ya existen no se pueden repetir.
  for (const dni of await Usuario.find({ dni: { $type: "string" } }).distinct("dni")) dnisUsados.add(dni);
  hashDemo = await bcrypt.hash(PASSWORD_DEMO, 10);

  const inicio = Date.now();
  const duenos: (Doc & { _id: Types.ObjectId })[] = [];
  const marcas: Types.ObjectId[] = [];
  for (const negocio of NEGOCIOS) {
    const r = simularNegocio(negocio);
    marcas.push(r.marcaId);
    duenos.push(...r.duenos);
  }

  for (const c of CUENTAS_SUELTAS) {
    const creada = enHorario(inicioHaceDias(c.creadaHace));
    const acceso = c.ultimoAccesoHace !== undefined ? { ultimoAcceso: haceDias(c.ultimoAccesoHace, entre(0, 6)), ...(c.version && { ultimaVersionApp: c.version }) } : {};
    const extra: Doc = { ...acceso };
    if (c.paso === "terminos") Object.assign(extra, { terminosYCondicionesVersion: "2026-08-01", dni: dniNuevo(20_000_000, 42_000_000) });
    if (c.paso === "marca") extra["dni"] = dniNuevo(20_000_000, 42_000_000);
    if (c.paso === "suspendida") {
      Object.assign(extra, {
        dni: dniNuevo(20_000_000, 42_000_000),
        suspendida: true,
        suspendidaEl: haceDias(23),
        motivoSuspension: "Cuenta de spam: cargaba publicidad en los nombres de los clientes",
      });
    }
    armarUsuario(c, creada, extra);
  }

  sembrarErrores(duenos);

  console.log("Insertando:");
  await insertar(Usuario, lote.usuarios);
  await insertar(Marca, lote.marcas);
  await insertar(Especie, lote.especies);
  await insertar(Cliente, lote.clientes);
  await insertar(Factura, lote.facturas);
  await insertar(Ticket, lote.tickets);
  await insertar(Pago, lote.pagos);
  await insertar(ErrorCliente, lote.errores);

  // Las estadísticas de cada marca, con la misma función que usa la app.
  for (const id of marcas) await recalcularMarca(id);

  // Control: una muestra de facturas recalculada por la app tiene que dar lo mismo.
  const muestra = await Factura.find({ marca: { $in: marcas }, cantidadTickets: { $gt: 0 } }).limit(25);
  let distintas = 0;
  for (const f of muestra) {
    const antes = { saldo: f.saldo, totalFiado: f.totalFiado, totalPagos: f.totalPagos, cumplimiento: f.cumplimiento };
    const despues = await recalcularFactura(f._id);
    const iguales = antes.saldo === despues.saldo && antes.totalFiado === despues.totalFiado && antes.totalPagos === despues.totalPagos && antes.cumplimiento === despues.cumplimiento;
    if (!iguales) {
      distintas++;
      console.warn("  ! factura distinta al recalcular:", String(f._id), antes, { saldo: despues.saldo, totalFiado: despues.totalFiado, totalPagos: despues.totalPagos, cumplimiento: despues.cumplimiento });
    }
  }
  console.log(`Control: ${muestra.length - distintas}/${muestra.length} facturas coinciden con recalcularFactura`);

  const resumen = await Marca.find({ _id: { $in: marcas } }).select("nombre estadisticas").sort({ "estadisticas.totalVendido": -1 });
  console.log("\nMarcas sembradas:");
  for (const m of resumen) {
    const e = m.estadisticas;
    console.log(
      `  ${m.nombre.padEnd(26)} ${String(e.cantidadClientes).padStart(3)} clientes · vendido $${Math.round(e.totalVendido).toLocaleString("es-AR").padStart(12)} · deuda $${Math.round(e.deudaPendiente).toLocaleString("es-AR").padStart(10)}`
    );
  }
  console.log(`\nListo en ${((Date.now() - inicio) / 1000).toFixed(1)} s. Las cuentas demo entran con la contraseña "${PASSWORD_DEMO}".`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
