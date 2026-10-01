import type { Types } from "mongoose";
import Especie from "../models/Especie.js";
import type { DescuentoEspecie, ItemTicket } from "../models/Ticket.js";

/**
 * La cantidad de cada especie sigue a los tickets: la venta la descuenta, y
 * corregir o anular el ticket devuelve lo que se había descontado.
 *
 * Nunca frena una venta. La cantidad no baja de 0: si había 2 y se llevan 3
 * queda en 0, y si ya estaba en 0 (o la especie no lleva cantidad) no se toca.
 * El ticket se carga igual en todos los casos.
 */

/** Lo que se lleva de cada especie: dos renglones de la misma se suman. */
function unidadesPorEspecie(items: Pick<ItemTicket, "especie" | "cantidad">[]): DescuentoEspecie[] {
  const unidades = new Map<string, DescuentoEspecie>();
  for (const { especie, cantidad } of items) {
    const anterior = unidades.get(String(especie));
    if (anterior) anterior.cantidad += cantidad;
    else unidades.set(String(especie), { especie, cantidad });
  }
  return [...unidades.values()];
}

/**
 * Descuenta lo que se llevan y devuelve cuánto se descontó de verdad de cada
 * especie, que es lo que hay que guardar en el ticket para poder devolverlo.
 */
export async function descontarCantidades(
  items: Pick<ItemTicket, "especie" | "cantidad">[],
  marca: Types.ObjectId
): Promise<DescuentoEspecie[]> {
  const descontado = await Promise.all(
    unidadesPorEspecie(items).map(async ({ especie, cantidad }) => {
      // Resta y tope en la misma operación: dos ventas a la vez no pueden
      // leer la misma cantidad. Devuelve la especie como estaba antes.
      const antes = await Especie.findOneAndUpdate(
        { _id: especie, marca, cantidad: { $gt: 0 } },
        [{ $set: { cantidad: { $max: [0, { $subtract: ["$cantidad", cantidad] }] } } }],
        { projection: { cantidad: 1 } }
      );
      return { especie, cantidad: Math.min(antes?.cantidad ?? 0, cantidad) };
    })
  );
  return descontado.filter((d) => d.cantidad > 0);
}

/** Le devuelve a cada especie lo que el ticket le había descontado. */
export async function devolverCantidades(
  descontado: DescuentoEspecie[],
  marca: Types.ObjectId
): Promise<void> {
  await Promise.all(
    descontado.map(({ especie, cantidad }) =>
      // Si en el medio le sacaron la cantidad a la especie, no se la crea de nuevo.
      Especie.updateOne({ _id: especie, marca, cantidad: { $type: "number" } }, { $inc: { cantidad } })
    )
  );
}
