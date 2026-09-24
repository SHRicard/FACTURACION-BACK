import Usuario from "../../models/Usuario.js";
import Marca from "../../models/Marca.js";
import Cliente from "../../models/Cliente.js";
import Factura from "../../models/Factura.js";
import Ticket from "../../models/Ticket.js";
import Pago from "../../models/Pago.js";
import ErrorCliente from "../../models/ErrorCliente.js";
import { ESTADOS_ONBOARDING, filtroOnboarding, haceDias, inicioDeHoy, redondear } from "./comun.js";
import { DIAS_MARCA_ACTIVA, marcasConActividad } from "./marcas.js";

/**
 * GET /admin/resumen — el tablero del super_admin: cuánta gente usa la app,
 * cuántas marcas trabajan de verdad, cuánta plata pasa por la plataforma y
 * si la app se está rompiendo.
 *
 * Todo en una sola respuesta para que la pantalla principal cargue de una.
 */
export async function resumenPlataforma() {
  const ahora = new Date();
  const hoy = inicioDeHoy(ahora);
  const hace7 = haceDias(7, ahora);
  const hace30 = haceDias(30, ahora);
  const hace24h = haceDias(1, ahora);
  const admin = { rol: "administrador" };
  const activos = { anulado: { $ne: true } };

  const [
    usuariosPorRol,
    usuariosPorProveedor,
    nuevosHoy,
    nuevos7d,
    nuevos30d,
    activos7d,
    activos30d,
    suspendidos,
    pendientes,
    marcasTotal,
    marcasNuevas30d,
    marcasActivas,
    marcasConLogo,
    totalesMarcas,
    clientes,
    facturasAbiertas,
    facturasVencidas,
    tickets30d,
    pagos30d,
    errores,
    ultimosUsuarios,
    ultimasMarcas,
  ] = await Promise.all([
    Usuario.aggregate<{ _id: string; n: number }>([{ $group: { _id: "$rol", n: { $sum: 1 } } }]),
    Usuario.aggregate<{ _id: string; n: number }>([
      { $match: admin },
      { $group: { _id: "$proveedor", n: { $sum: 1 } } },
    ]),
    Usuario.countDocuments({ ...admin, createdAt: { $gte: hoy } }),
    Usuario.countDocuments({ ...admin, createdAt: { $gte: hace7 } }),
    Usuario.countDocuments({ ...admin, createdAt: { $gte: hace30 } }),
    Usuario.countDocuments({ ...admin, ultimoAcceso: { $gte: hace7 } }),
    Usuario.countDocuments({ ...admin, ultimoAcceso: { $gte: hace30 } }),
    Usuario.countDocuments({ suspendida: true }),
    Promise.all(
      ESTADOS_ONBOARDING.filter((e) => e !== "listo").map(async (e) => [e, await Usuario.countDocuments(filtroOnboarding(e))] as const)
    ),
    Marca.countDocuments(),
    Marca.countDocuments({ createdAt: { $gte: hace30 } }),
    marcasConActividad(haceDias(DIAS_MARCA_ACTIVA, ahora)),
    Marca.countDocuments({ logoUrl: { $type: "string" } }),
    Marca.aggregate<{ vendido: number; cobrado: number; deuda: number }>([
      {
        $group: {
          _id: null,
          vendido: { $sum: "$estadisticas.totalVendido" },
          cobrado: { $sum: "$estadisticas.totalCobrado" },
          deuda: { $sum: "$estadisticas.deudaPendiente" },
        },
      },
    ]),
    Cliente.estimatedDocumentCount(),
    Factura.countDocuments({ estado: "abierta", saldo: { $gt: 0 } }),
    Factura.countDocuments({ estado: "abierta", saldo: { $gt: 0 }, venceEl: { $lt: ahora } }),
    Ticket.aggregate<{ n: number; vendido: number; dejado: number }>([
      { $match: { ...activos, createdAt: { $gte: hace30 } } },
      { $group: { _id: null, n: { $sum: 1 }, vendido: { $sum: "$total" }, dejado: { $sum: "$pagado" } } },
    ]),
    Pago.aggregate<{ n: number; cobrado: number }>([
      { $match: { ...activos, createdAt: { $gte: hace30 } } },
      { $group: { _id: null, n: { $sum: 1 }, cobrado: { $sum: "$monto" } } },
    ]),
    ErrorCliente.aggregate<{ ultimas24h: number; ultimos7d: number; fatales7d: number; grupos7d: string[] }>([
      { $match: { createdAt: { $gte: hace7 } } },
      {
        $group: {
          _id: null,
          ultimos7d: { $sum: 1 },
          ultimas24h: { $sum: { $cond: [{ $gte: ["$createdAt", hace24h] }, 1, 0] } },
          fatales7d: { $sum: { $cond: ["$fatal", 1, 0] } },
          grupos7d: { $addToSet: "$huella" },
        },
      },
    ]),
    Usuario.find(admin)
      .sort({ createdAt: -1 })
      .limit(5)
      .select("nombre email avatar proveedor createdAt marca")
      .populate({ path: "marca", select: "nombre" }),
    Marca.find().sort({ createdAt: -1 }).limit(5).select("nombre logoUrl createdAt estadisticas"),
  ]);

  const porRol = Object.fromEntries(usuariosPorRol.map(({ _id, n }) => [_id, n]));
  const porProveedor = Object.fromEntries(usuariosPorProveedor.map(({ _id, n }) => [_id, n]));
  const totales = totalesMarcas[0];
  const t30 = tickets30d[0];
  const p30 = pagos30d[0];
  const e = errores[0];

  return {
    generadoEl: ahora,
    usuarios: {
      administradores: porRol["administrador"] ?? 0,
      superAdmins: porRol["super_admin"] ?? 0,
      porProveedor: { local: porProveedor["local"] ?? 0, google: porProveedor["google"] ?? 0 },
      nuevos: { hoy: nuevosHoy, ultimos7d: nuevos7d, ultimos30d: nuevos30d },
      activos: { ultimos7d: activos7d, ultimos30d: activos30d },
      suspendidos,
      /** Cuántos quedaron a mitad del onboarding, en cada paso. */
      pendientes: Object.fromEntries(pendientes) as Record<"terminos" | "perfil" | "marca", number>,
    },
    marcas: {
      total: marcasTotal,
      nuevas30d: marcasNuevas30d,
      activas30d: marcasActivas.length,
      inactivas30d: Math.max(0, marcasTotal - marcasActivas.length),
      conLogo: marcasConLogo,
    },
    negocio: {
      clientes,
      facturasConDeuda: facturasAbiertas,
      facturasVencidas,
      historico: {
        vendido: redondear(totales?.vendido ?? 0),
        cobrado: redondear(totales?.cobrado ?? 0),
        deudaPendiente: redondear(totales?.deuda ?? 0),
      },
      ultimos30d: {
        tickets: t30?.n ?? 0,
        pagos: p30?.n ?? 0,
        vendido: redondear(t30?.vendido ?? 0),
        cobrado: redondear((t30?.dejado ?? 0) + (p30?.cobrado ?? 0)),
      },
    },
    errores: {
      ultimas24h: e?.ultimas24h ?? 0,
      ultimos7d: e?.ultimos7d ?? 0,
      fatales7d: e?.fatales7d ?? 0,
      distintos7d: e?.grupos7d.length ?? 0,
    },
    recientes: { usuarios: ultimosUsuarios, marcas: ultimasMarcas },
  };
}
