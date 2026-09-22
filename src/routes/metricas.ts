import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireMarca } from "../middleware/marca.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  AGRUPACIONES,
  leerBooleano,
  leerEntero,
  leerOpcion,
  leerPaginacion,
  leerPeriodo,
  leerPeriodoOpcional,
  leerTexto,
} from "../services/metricas/comun.js";
import { tasaCobranza } from "../services/metricas/tasaCobranza.js";
import { pagosATiempo } from "../services/metricas/pagosATiempo.js";
import { ORDENES_DEUDORES, deudores } from "../services/metricas/deudores.js";
import {
  DIAS_INACTIVO_POR_DEFECTO,
  ORDENES_INACTIVOS,
  clientesInactivos,
} from "../services/metricas/clientesInactivos.js";
import {
  LIMITE_MEJORES_DEFECTO,
  LIMITE_MEJORES_MAXIMO,
  ORDENES_MEJORES,
  mejoresClientes,
} from "../services/metricas/mejoresClientes.js";
import {
  ESTADOS_FRECUENCIA,
  ORDENES_FRECUENCIA,
  frecuenciaCompra,
} from "../services/metricas/frecuenciaCompra.js";
import {
  ORDENES_ESPECIE,
  detalleEspecie,
  ventasPorEspecie,
} from "../services/metricas/ventasPorEspecie.js";
import { ORDENES_MOROSOS, morosos } from "../services/metricas/morosos.js";
import { RESUMEN_POR_DEFECTO, resumen } from "../services/metricas/resumen.js";
import type { RequestConMarca } from "../types/index.js";

/**
 * Las métricas de la marca: una ruta por métrica, una pantalla por ruta.
 *
 * Todas se calculan al pedirlas. Las que miran un período reciben `desde` y
 * `hasta` (aaaa-mm-dd, los dos días incluidos); sin eso, el mes en curso y
 * los 5 anteriores. Ver doc/dashboard_metricas.md.
 */
const router = Router();
router.use(requireAuth, requireMarca);

// GET /metricas/tasa-cobranza?desde&hasta
router.get(
  "/tasa-cobranza",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(await tasaCobranza(req.marca._id, leerPeriodo(req.query)));
  })
);

// GET /metricas/pagos-a-tiempo?desde&hasta
//
// El cumplimiento de las facturas. El período es el de su vencimiento
// ORIGINAL, no el de pago.
router.get(
  "/pagos-a-tiempo",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(await pagosATiempo(req.marca._id, leerPeriodo(req.query)));
  })
);

// GET /metricas/deudores?desde&hasta&agrupar=mes|semana&orden=saldo|atraso&buscar&pagina&porPagina
//
// Cuánta plata hay en la calle y si crece o baja: arriba la evolución del
// período, abajo la lista de los que deben hoy. Ver doc/DEUDORES.md.
router.get(
  "/deudores",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await deudores(req.marca._id, {
        periodo: leerPeriodo(req.query),
        agrupar: leerOpcion(req.query, "agrupar", AGRUPACIONES, "mes"),
        buscar: leerTexto(req.query, "buscar"),
        soloMorosos: leerBooleano(req.query, "morosos"),
        orden: leerOpcion(req.query, "orden", ORDENES_DEUDORES, "saldo"),
        paginacion: leerPaginacion(req.query),
      })
    );
  })
);

// GET /metricas/resumen?dias&venceEnDias&diasInactivo&meses&limite
//
// El dashboard entero en una sola consulta: a quién cobrarle, cómo viene el
// mes contra el anterior, qué se vende y lo último que se cargó.
router.get(
  "/resumen",
  asyncHandler<RequestConMarca>(async (req, res) => {
    const entero = (campo: keyof typeof RESUMEN_POR_DEFECTO, min: number, max: number) =>
      leerEntero(req.query, campo, { defecto: RESUMEN_POR_DEFECTO[campo], min, max });

    res.json(
      await resumen(req.marca._id, {
        dias: entero("dias", 1, 90),
        venceEnDias: entero("venceEnDias", 1, 90),
        diasInactivo: entero("diasInactivo", 1, 730),
        meses: entero("meses", 1, 24),
        limite: entero("limite", 1, 10),
      })
    );
  })
);

// GET /metricas/morosos?desde&hasta&agrupar=mes|semana&orden=atraso|saldo&buscar&pagina&porPagina
//
// Arriba, cómo fueron cambiando los morosos en el período; abajo, la lista de
// los de hoy.
router.get(
  "/morosos",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await morosos(req.marca._id, {
        periodo: leerPeriodo(req.query),
        agrupar: leerOpcion(req.query, "agrupar", AGRUPACIONES, "mes"),
        buscar: leerTexto(req.query, "buscar"),
        orden: leerOpcion(req.query, "orden", ORDENES_MOROSOS, "atraso"),
        paginacion: leerPaginacion(req.query),
      })
    );
  })
);

// GET /metricas/clientes-inactivos?dias=60&orden=saldo|dias&pagina&porPagina
router.get(
  "/clientes-inactivos",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await clientesInactivos(req.marca._id, {
        dias: leerEntero(req.query, "dias", { defecto: DIAS_INACTIVO_POR_DEFECTO, min: 1, max: 730 }),
        orden: leerOpcion(req.query, "orden", ORDENES_INACTIVOS, "saldo"),
        paginacion: leerPaginacion(req.query),
      })
    );
  })
);

// GET /metricas/mejores-clientes?desde&hasta&orden=cumplimiento|compras&limite=10
//
// A diferencia del resto, sin `desde` ni `hasta` mira TODA la historia: el
// mejor cliente sale del cumplimiento de todas sus facturas.
router.get(
  "/mejores-clientes",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await mejoresClientes(req.marca._id, {
        periodo: leerPeriodoOpcional(req.query),
        orden: leerOpcion(req.query, "orden", ORDENES_MEJORES, "cumplimiento"),
        limite: leerEntero(req.query, "limite", {
          defecto: LIMITE_MEJORES_DEFECTO,
          min: 1,
          max: LIMITE_MEJORES_MAXIMO,
        }),
      })
    );
  })
);

// GET /metricas/frecuencia-compra?desde&hasta&estado&orden=frecuencia|demorados&pagina&porPagina
router.get(
  "/frecuencia-compra",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await frecuenciaCompra(req.marca._id, {
        periodo: leerPeriodo(req.query),
        estado: leerOpcion(req.query, "estado", ESTADOS_FRECUENCIA),
        orden: leerOpcion(req.query, "orden", ORDENES_FRECUENCIA, "frecuencia"),
        paginacion: leerPaginacion(req.query),
      })
    );
  })
);

// GET /metricas/ventas-por-especie?desde&hasta&orden=unidades|monto
//
// Cuánto se vendió de cada especie.
router.get(
  "/ventas-por-especie",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(
      await ventasPorEspecie(
        req.marca._id,
        leerPeriodo(req.query),
        leerOpcion(req.query, "orden", ORDENES_ESPECIE, "unidades")
      )
    );
  })
);

// GET /metricas/ventas-por-especie/:especie?desde&hasta
//
// El detalle de una especie: qué artículos y qué talles, y mes a mes.
router.get(
  "/ventas-por-especie/:especie",
  asyncHandler<RequestConMarca>(async (req, res) => {
    res.json(await detalleEspecie(req.marca._id, req.params["especie"] ?? "", leerPeriodo(req.query)));
  })
);

export default router;
