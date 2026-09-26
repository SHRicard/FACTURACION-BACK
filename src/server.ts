import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import type { Server } from "node:http";
import "dotenv/config";
import { connectDB } from "./config/db.js";
import { validarEntorno, saltosDeProxy } from "./config/entorno.js";
import Usuario from "./models/Usuario.js";

import { logger } from "./utils/logger.js";
import { verificarEmail } from "./utils/email.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";
import { exigirVersionMinima } from "./middleware/versionApp.js";
import { detenerAvisos, iniciarAvisos } from "./services/avisos.js";

import authRouter from "./routes/auth.js";
import usuariosRouter from "./routes/usuarios.js";
import clientesRouter from "./routes/clientes.js";
import productosRouter from "./routes/productos.js";
import facturasRouter from "./routes/facturas.js";
import especiesRouter from "./routes/especies.js";
import ticketsRouter from "./routes/tickets.js";
import pagosRouter from "./routes/pagos.js";
import publicoRouter from "./routes/publico.js";
import marcasRouter from "./routes/marcas.js";
import metricasRouter from "./routes/metricas.js";
import legalRouter from "./routes/legal.js";
import appRouter from "./routes/app.js";
import cuentaRouter from "./routes/cuenta.js";
import adminRouter from "./routes/admin.js";

// Antes que nada: en producción, con un secreto de ejemplo o una variable que
// falta, el server no arranca (ver config/entorno.ts).
validarEntorno();

// Apagado ordenado (SIGTERM): mientras se apaga, /health responde 503 para
// que el hosting deje de mandar tráfico acá.
let apagando = false;
const SEGUNDOS_GRACIA_APAGADO = 10;

const app = express();
// Cuántos proxies hay delante (TRUST_PROXY), exacto y nunca `true`. Sin esto
// req.ip es la IP del proxy del hosting y todos los usuarios comparten el
// mismo contador del rate limit; con `true`, cualquiera falsifica su IP
// mandando un X-Forwarded-For inventado.
app.set("trust proxy", saltosDeProxy() ?? 0);
// El front web lee el nombre del PDF de Content-Disposition, y el navegador
// solo le deja leer los headers que se exponen acá.
app.use(cors({ exposedHeaders: ["Content-Disposition"] }));
app.use(express.json());
app.use(requestLogger);

app.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ mensaje: "API de cuenta corriente funcionando 🚀" });
  }),
);

// GET /health — el healthcheck del hosting, sin auth. 200 solo si Mongo está
// conectado y el server no se está apagando; si no, 503 con la misma forma,
// así el hosting saca esta instancia del balanceo en vez de mandarle requests
// que van a fallar.
const ESTADOS_MONGO: Record<number, string> = {
  0: "desconectado",
  1: "conectado",
  2: "conectando",
  3: "desconectando",
};

app.get("/health", (_req, res) => {
  const estado = mongoose.connection.readyState;
  const ok = estado === 1 && !apagando;
  res
    .set("Cache-Control", "no-store")
    .status(ok ? 200 : 503)
    .json({ ok, mongo: ESTADOS_MONGO[estado] ?? "desconocido", apagando });
});

// Las versiones de la app más viejas que APP_VERSION_MINIMA reciben 426 (K8).
// Va después de "/" y "/health" y antes de todos los routers.
app.use(exigirVersionMinima);

// Van antes que los routers montados en "/".
// La app: versión mínima (K8) y reporte de errores (K12).
app.use("/app", appRouter);
// Páginas HTML que se abren desde los mails: nueva contraseña y abrir la app (K9).
app.use("/cuenta", cuentaRouter);

app.use("/auth", authRouter);
app.use("/usuarios", usuariosRouter);
app.use("/marcas", marcasRouter);
app.use("/clientes", clientesRouter);
app.use("/productos", productosRouter);
app.use("/especies", especiesRouter);
app.use("/facturas", facturasRouter);
app.use("/metricas", metricasRouter);
// El panel del super_admin (ver doc/SUPER_ADMIN.md).
app.use("/admin", adminRouter);
// Documentos legales públicos: Play Console y la app pueden consultarlos sin login.
app.use("/legal", legalRouter);
// Sin login: los links que el cliente abre desde WhatsApp.
app.use("/publico", publicoRouter);
// Estos dos definen rutas completas:
//   tickets → /clientes/:id/tickets, /clientes/:id/factura-actual, /tickets/:id
//   pagos   → /clientes/:id/pagos, /facturas/:id/pagos, /pagos/:id
app.use("/", ticketsRouter);
app.use("/", pagosRouter);

// Estos dos van siempre al final, después de todas las rutas.
app.use(notFound);
app.use(errorHandler);

// Crea el super_admin la primera vez que arranca el servidor, si no existe todavia
async function crearSuperAdminInicial(): Promise<void> {
  const existe = await Usuario.findOne({ rol: "super_admin" });
  if (existe) return;

  const email = process.env["SUPER_ADMIN_EMAIL"];
  const password = process.env["SUPER_ADMIN_PASSWORD"];

  if (!email || !password) {
    logger.warn(
      "Sin SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD no se crea el super admin inicial",
    );
    return;
  }

  await Usuario.create({
    nombre: "Super Admin",
    email,
    password,
    rol: "super_admin",
  });
  logger.success(`Super admin creado: ${email}`);
}

// Apagado ordenado. En cada deploy el hosting manda SIGTERM: en vez de morir
// en el acto, el server deja de aceptar conexiones nuevas, termina las
// requests en curso (hasta SEGUNDOS_GRACIA_APAGADO) y recién ahí cierra Mongo
// y sale. Así un deploy no corta a la mitad un registro de pago: el front no
// sabría si se guardó y lo reintentaría. SIGINT (Ctrl+C) hace lo mismo.
function registrarApagado(server: Server): void {
  const apagar = (senal: NodeJS.Signals): void => {
    if (apagando) return;
    apagando = true;
    logger.info(
      `${senal} recibido: termino las requests en curso (hasta ${SEGUNDOS_GRACIA_APAGADO} s) y cierro`,
    );

    // Si alguna request se cuelga, no esperamos para siempre: pasado el
    // plazo se cortan las conexiones que queden.
    const corte = setTimeout(() => {
      logger.warn(
        `Pasaron ${SEGUNDOS_GRACIA_APAGADO} s y quedan conexiones abiertas: las corto`,
      );
      server.closeAllConnections();
    }, SEGUNDOS_GRACIA_APAGADO * 1000).unref();

    server.close((error) => {
      clearTimeout(corte);
      // El aviso que se está mandando termina su lote y queda para el próximo
      // arranque (ver services/avisos.ts), antes de cerrar Mongo.
      detenerAvisos()
        .then(() => mongoose.disconnect())
        .catch((e: unknown) => logger.error(e))
        .finally(() => process.exit(error ? 1 : 0));
    });
    // Las conexiones keep-alive sin request en curso no tienen nada que
    // terminar: se cierran ya para que server.close no las espere.
    server.closeIdleConnections();
  };

  process.once("SIGTERM", apagar);
  process.once("SIGINT", apagar);
}

// Nada de esto debería pasar, pero si pasa queremos verlo en la consola
// en vez de que el proceso muera (o siga vivo y roto) en silencio.
process.on("unhandledRejection", (motivo: unknown) => {
  logger.error("Promesa rechazada sin catch:");
  logger.error(motivo);
});

process.on("uncaughtException", (error: Error) => {
  logger.error("Excepción no atrapada, cerrando el proceso:");
  logger.error(error);
  process.exit(1);
});

const PORT = Number(process.env["PORT"] ?? 4000);

connectDB()
  .then(async () => {
    await crearSuperAdminInicial();
    await verificarEmail();
    await iniciarAvisos();

    const server = app.listen(PORT, () => {
      logger.success(`Servidor corriendo en http://localhost:${PORT}`);
      logger.info(
        `Entorno: ${process.env["NODE_ENV"] ?? "development"} · LOG_LEVEL: ${
          process.env["LOG_LEVEL"] ?? "(auto)"
        } · trust proxy: ${saltosDeProxy() ?? 0}`,
      );
    });

    registrarApagado(server);
  })
  .catch((error: unknown) => {
    logger.error("No se pudo arrancar el servidor:");
    logger.error(error);
    process.exit(1);
  });

export default app;
