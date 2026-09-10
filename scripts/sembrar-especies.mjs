// Siembra una lista inicial de especies para un administrador.
//
//   node scripts/sembrar-especies.mjs <email>
//
// Son categorías amplias a propósito: la gracia de la especie es agrupar, así
// que la lista tiene que quedar corta. "Campera" sí, "Campera de invierno azul"
// no — eso se escribe en el ticket.
//
// Es idempotente: las que ya existan se saltean, no se duplican ni se pisan.
import mongoose from "mongoose";
import "dotenv/config";

const ESPECIES = [
  ["Pantalón", "Largos: de vestir, jean, cargo, jogging"],
  ["Pantalón corto", "Shorts y bermudas"],
  ["Remera", "Manga corta, manga larga y musculosas"],
  ["Camisa", "De vestir y leñadoras"],
  ["Buzo", "Con y sin capucha"],
  ["Campera", "Abrigos, rompevientos e inflables"],
  ["Zapatilla", "Calzado deportivo y urbano"],
  ["Media", "Cortas, largas y deportivas"],
  ["Ropa interior", "Ropa interior y pijamas"],
  ["Gorra", "Gorras, gorros y accesorios"],
];

const email = process.argv[2];
if (!email) {
  console.error("Falta el email: node scripts/sembrar-especies.mjs <email>");
  process.exit(1);
}

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const usuario = await db.collection("usuarios").findOne({ email });
if (!usuario) {
  console.error(`No hay ningún usuario con el email ${email}`);
  await mongoose.disconnect();
  process.exit(1);
}

const yaEstan = new Set(
  (await db.collection("especies").find({ administrador: usuario._id }).toArray()).map(
    (e) => e.nombre
  )
);

const ahora = new Date();
const nuevas = ESPECIES.filter(([nombre]) => !yaEstan.has(nombre)).map(([nombre, descripcion]) => ({
  nombre,
  descripcion,
  activo: true,
  administrador: usuario._id,
  createdAt: ahora,
  updatedAt: ahora,
  __v: 0,
}));

if (nuevas.length) await db.collection("especies").insertMany(nuevas);

console.log(`${usuario.nombre ?? email} (${email})`);
console.log(`  creadas: ${nuevas.length}   ya estaban: ${ESPECIES.length - nuevas.length}`);
console.log("");
for (const e of await db
  .collection("especies")
  .find({ administrador: usuario._id })
  .sort({ nombre: 1 })
  .toArray()) {
  console.log(`  ${e.activo ? "●" : "○"} ${e.nombre.padEnd(16)} ${e.descripcion ?? ""}`);
}

await mongoose.disconnect();
