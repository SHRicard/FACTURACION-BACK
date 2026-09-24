import mongoose from "mongoose";
import Usuario from "../../models/Usuario.js";
import { configVersion, compararVersiones } from "../../utils/version.js";
import { smtpConfigurado } from "../../utils/email.js";
import { configCloudinary } from "../cloudinary.js";
import { googleConfigurado } from "../../utils/google.js";
import { VERSION_DOCUMENTOS_LEGALES } from "../../legal/documentos.js";
import { logger } from "../../utils/logger.js";
import { haceDias } from "./comun.js";

/**
 * GET /admin/sistema — el estado técnico del server: memoria, base,
 * servicios externos configurados y qué versiones de la app se están usando.
 *
 * Nunca devuelve secretos: de cada servicio dice solo si está configurado.
 */

const ESTADOS_MONGO: Record<number, string> = {
  0: "desconectado",
  1: "conectado",
  2: "conectando",
  3: "desconectando",
};

const aMb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10;

interface EstadoColeccion {
  nombre: string;
  documentos: number;
  tamanoMb: number | null;
}

/**
 * Las colecciones con cuántos documentos tienen. El tamaño sale de
 * $collStats, que algunos planes de Atlas no permiten: ahí queda en null.
 */
async function colecciones(): Promise<EstadoColeccion[]> {
  const db = mongoose.connection.db;
  if (!db) return [];

  const lista = await db.listCollections({}, { nameOnly: true }).toArray();
  const estados = await Promise.all(
    lista.map(async ({ name }): Promise<EstadoColeccion> => {
      const coleccion = db.collection(name);
      const documentos = await coleccion.estimatedDocumentCount();
      let tamanoMb: number | null = null;
      try {
        const [stats] = await coleccion
          .aggregate<{ storageStats?: { size?: number } }>([{ $collStats: { storageStats: {} } }])
          .toArray();
        if (typeof stats?.storageStats?.size === "number") tamanoMb = aMb(stats.storageStats.size);
      } catch {
        // Sin permiso para $collStats: se muestra solo la cantidad.
      }
      return { nombre: name, documentos, tamanoMb };
    })
  );
  return estados.sort((a, b) => b.documentos - a.documentos);
}

async function tamanoBase(): Promise<{ datosMb: number; almacenamientoMb: number; indicesMb: number } | null> {
  try {
    const stats = await mongoose.connection.db?.stats();
    if (!stats) return null;
    return {
      datosMb: aMb(Number(stats["dataSize"] ?? 0)),
      almacenamientoMb: aMb(Number(stats["storageSize"] ?? 0)),
      indicesMb: aMb(Number(stats["indexSize"] ?? 0)),
    };
  } catch (error) {
    logger.warn(error);
    return null;
  }
}

export async function estadoSistema() {
  const memoria = process.memoryUsage();
  const version = configVersion();

  const [listaColecciones, base, versionesEnUso] = await Promise.all([
    colecciones(),
    tamanoBase(),
    // Qué versión de la app usó cada uno en su último acceso, entre los que
    // entraron en los últimos 30 días.
    Usuario.aggregate<{ _id: string | null; usuarios: number }>([
      { $match: { rol: "administrador", ultimoAcceso: { $gte: haceDias(30) } } },
      { $group: { _id: "$ultimaVersionApp", usuarios: { $sum: 1 } } },
      { $sort: { usuarios: -1 } },
    ]),
  ]);

  return {
    generadoEl: new Date(),
    servidor: {
      entorno: process.env["NODE_ENV"] ?? "development",
      node: process.version,
      uptimeSegundos: Math.round(process.uptime()),
      iniciadoEl: new Date(Date.now() - process.uptime() * 1000),
      memoria: {
        rssMb: aMb(memoria.rss),
        heapUsadoMb: aMb(memoria.heapUsed),
        heapTotalMb: aMb(memoria.heapTotal),
      },
    },
    mongo: {
      estado: ESTADOS_MONGO[mongoose.connection.readyState] ?? "desconocido",
      base: mongoose.connection.name,
      tamano: base,
      colecciones: listaColecciones,
    },
    servicios: {
      email: smtpConfigurado(),
      cloudinary: configCloudinary() !== null,
      google: googleConfigurado(),
    },
    app: {
      ...version,
      versionDocumentosLegales: VERSION_DOCUMENTOS_LEGALES,
      versionesEnUso: versionesEnUso.map(({ _id, usuarios }) => ({
        version: _id ?? "desconocida",
        usuarios,
        // Los que ya reciben 426 al abrir la app.
        bloqueada: _id ? compararVersiones(_id, version.minima) === -1 : false,
      })),
    },
  };
}
