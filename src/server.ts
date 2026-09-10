import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { connectDB } from "./config/db.js";
import Usuario from "./models/Usuario.js";

import { logger } from "./utils/logger.js";
import { verificarEmail } from "./utils/email.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { errorHandler, notFound } from "./middleware/errorHandler.js";

import authRouter from "./routes/auth.js";
import usuariosRouter from "./routes/usuarios.js";
import clientesRouter from "./routes/clientes.js";
import productosRouter from "./routes/productos.js";
import facturasRouter from "./routes/facturas.js";
import especiesRouter from "./routes/especies.js";
import ticketsRouter from "./routes/tickets.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(requestLogger);

app.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json({ mensaje: "API de cuenta corriente funcionando 🚀" });
  })
);

app.use("/auth", authRouter);
app.use("/usuarios", usuariosRouter);
app.use("/clientes", clientesRouter);
app.use("/productos", productosRouter);
app.use("/especies", especiesRouter);
app.use("/facturas", facturasRouter);
// Define rutas completas: /clientes/:id/tickets, /clientes/:id/pagos, /tickets/:id
app.use("/", ticketsRouter);

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
    logger.warn("Sin SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD no se crea el super admin inicial");
    return;
  }

  await Usuario.create({ nombre: "Super Admin", email, password, rol: "super_admin" });
  logger.success(`Super admin creado: ${email}`);
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

    app.listen(PORT, () => {
      logger.success(`Servidor corriendo en http://localhost:${PORT}`);
      logger.info(
        `Entorno: ${process.env["NODE_ENV"] ?? "development"} · LOG_LEVEL: ${
          process.env["LOG_LEVEL"] ?? "(auto)"
        }`
      );
    });
  })
  .catch((error: unknown) => {
    logger.error("No se pudo arrancar el servidor:");
    logger.error(error);
    process.exit(1);
  });

export default app;
