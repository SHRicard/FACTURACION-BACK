// Migración: catálogo → especie.
//
// Copia (no mueve) `catalogos` a `especies` conservando los _id, y reescribe
// los ítems de los tickets ya cargados. La colección `catalogos` queda intacta
// como respaldo: si algo sale mal, no se perdió nada.
import mongoose from "mongoose";
import "dotenv/config";

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

// 1. catalogos → especies, con el mismo _id para que las referencias sigan valiendo
const catalogos = await db.collection("catalogos").find({}).toArray();
const yaEstan = await db.collection("especies").countDocuments();

if (yaEstan > 0) {
  console.log(`especies: ya tenía ${yaEstan} documentos, no toco nada`);
} else if (catalogos.length) {
  await db.collection("especies").insertMany(catalogos);
  console.log(`especies: ${catalogos.length} copiadas desde catalogos (mismos _id)`);
} else {
  console.log("catalogos: vacío, nada que copiar");
}

// 2. productos: el campo catalogo pasa a llamarse especie
const productos = await db.collection("productos").updateMany(
  { catalogo: { $exists: true } },
  { $rename: { catalogo: "especie" } }
);
console.log(`productos: ${productos.modifiedCount} con especie`);

// 3. tickets: cada ítem pasa a { especie, especieNombre } y pierde `producto`
let ticketsTocados = 0;
for (const ticket of await db.collection("tickets").find({}).toArray()) {
  const items = (ticket.items ?? []).map((item) => {
    const { catalogo, catalogoNombre, producto, ...resto } = item;
    return {
      nombre: resto.nombre,
      ...(resto.talle && { talle: resto.talle }),
      especie: item.especie ?? catalogo,
      especieNombre: item.especieNombre ?? catalogoNombre,
      cantidad: resto.cantidad,
      precioUnitario: resto.precioUnitario,
      subtotal: resto.subtotal,
    };
  });

  await db.collection("tickets").updateOne({ _id: ticket._id }, { $set: { items } });
  ticketsTocados++;
}
console.log(`tickets: ${ticketsTocados} con los ítems reescritos`);

// 4. Cómo quedó
const muestra = await db.collection("tickets").findOne({});
console.log("\nun ítem migrado:", JSON.stringify(muestra?.items?.[0] ?? null, null, 1));
console.log(
  "\nespecies:",
  (await db.collection("especies").find({}, { projection: { nombre: 1 } }).toArray())
    .map((e) => e.nombre)
    .join(" · ")
);

await mongoose.disconnect();
