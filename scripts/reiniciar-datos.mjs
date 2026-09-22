// Borra los datos del negocio de la base, para arrancar limpio con el modelo
// de marcas (antes todo era de un usuario; ahora es de una marca).
//
//   node scripts/reiniciar-datos.mjs --confirmar
//
// 1. Hace un respaldo con mongodump en respaldos/<base>-<fecha>/.
// 2. Borra clientes, especies, productos, facturas, tickets, pagos y marcas.
// 3. Saca el campo `marca` de los usuarios (quedó de la versión anterior,
//    cuando la marca iba adentro del usuario).
//
// Los usuarios quedan: al entrar les toca cargar su DNI y crear su marca.
// Para volver atrás:  mongorestore --drop respaldos/<carpeta>
import { execFileSync } from "node:child_process";
import mongoose from "mongoose";
import "dotenv/config";

const COLECCIONES = ["clientes", "especies", "productos", "facturas", "tickets", "pagos", "marcas"];

if (!process.argv.includes("--confirmar")) {
  console.error("Esto BORRA los datos del negocio (" + COLECCIONES.join(", ") + ").");
  console.error("Si estás seguro:  node scripts/reiniciar-datos.mjs --confirmar");
  process.exit(1);
}
if (process.env.NODE_ENV === "production") {
  console.error("No se corre con NODE_ENV=production.");
  process.exit(1);
}

const uri = process.env.MONGO_URI;
await mongoose.connect(uri);
const db = mongoose.connection.db;

// 1. Respaldo
const carpeta = `respaldos/${db.databaseName}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
console.log(`Respaldo en ${carpeta} …`);
execFileSync("mongodump", ["--uri", uri, "--out", carpeta, "--quiet"], { stdio: "inherit" });

// 2. Colecciones del negocio
const existentes = new Set((await db.listCollections().toArray()).map((c) => c.name));
for (const nombre of COLECCIONES) {
  if (!existentes.has(nombre)) continue;
  const cantidad = await db.collection(nombre).countDocuments();
  await db.collection(nombre).drop();
  console.log(`  ${nombre.padEnd(10)} borrada (${cantidad} documentos)`);
}

// 3. La marca vieja, embebida en el usuario
const { modifiedCount } = await db
  .collection("usuarios")
  .updateMany({ marca: { $exists: true } }, { $unset: { marca: "" } });
console.log(`  usuarios   sin marca vieja: ${modifiedCount}`);

console.log("\nListo. Al entrar, cada administrador carga su DNI y crea su marca.");
await mongoose.disconnect();
