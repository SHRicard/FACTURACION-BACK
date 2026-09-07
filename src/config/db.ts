import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

export async function connectDB(): Promise<void> {
  const uri = process.env["MONGO_URI"];

  if (!uri) {
    logger.error("Falta la variable MONGO_URI en el .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(uri);
    logger.success(`Conectado a MongoDB (${mongoose.connection.name})`);
  } catch (error) {
    logger.error("Error al conectar a MongoDB:");
    logger.error(error);
    process.exit(1);
  }

  // Si la conexión se cae mientras el server está andando, queremos enterarnos.
  mongoose.connection.on("error", (error) => logger.error("Error de MongoDB:", error));
  mongoose.connection.on("disconnected", () => logger.warn("MongoDB se desconectó"));
}
