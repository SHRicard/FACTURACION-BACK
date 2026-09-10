# Sección Especies

Todo lo necesario para armar la pantalla de especies. Autocontenido: no hace
falta leer otro documento salvo el cliente HTTP.

- **Base:** `http://localhost:4000`
- **Auth:** todos los endpoints piden `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

> **Reemplaza a `/catalogos`.** El endpoint viejo ya no existe: la colección se
> llama `especies` y la ruta es `/especies`. Los datos que había se migraron
> con los mismos `_id` (ver [scripts/migrar-especies.mjs](../scripts/migrar-especies.mjs)).

---

## Qué es una especie

El **tipo de mercadería**: `Pantalón`, `Pantalón corto`, `Zapatilla`, `Media`.

Es lo único que el administrador carga **antes** de vender, y lo carga una vez.
El artículo concreto no se da de alta en ningún lado: se escribe en el ticket,
en el momento.

```
ESPECIES  (se cargan una vez)        pantalón · pantalón corto · zapatilla · media
                                          ↑
TICKET    (se escribe al vender)     "Pantalón largo"   talle 34   $50.000   → pantalón
                                     "Media deportiva"  talle M    $ 3.000   → media
```

**No hay inventario, no hay stock, no hay que cargar productos de antemano.** El
administrador escribe lo que el cliente se lleva y elige la especie de una lista
corta.

### Para qué sirve entonces

Para que el nombre escrito a mano no se pierda como texto suelto. La especie
viaja **copiada dentro del ítem del ticket** (`especie` + `especieNombre`), y de
ahí salen las métricas de la etapa 7: qué se vende más, sin importar que un día
se haya escrito "Pantalón largo" y otro "Pantalon de vestir".

Por eso la lista tiene que quedar **corta**: son categorías, no productos. Si el
administrador termina con 60 especies, el objetivo se perdió.

## No se borran las que están en uso

Una especie que aparece en algún ticket **no se puede borrar**: se desactiva
(`activo: false`). Si se borrara, el historial quedaría hablando de un tipo de
mercadería que ya no existe y las métricas de ese período se irían con ella.

El backend te frena solo, con un `400` que dice cuántos tickets la nombran. En
el front eso se traduce en: **el botón de borrar ofrece desactivar cuando falla**.

---

## Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/especies` | Todas las del negocio |
| `POST` | `/especies` | Alta |
| `PUT` | `/especies/:id` | Edición parcial, y activar/desactivar |
| `DELETE` | `/especies/:id` | Borrado real, solo si no la usa nadie |

No hay `GET /especies/:id`: la lista es corta y viene entera, así que el detalle
sale de lo que ya tenés en memoria.

---

## GET /especies

Sin query params. Devuelve un **array plano**, no un objeto paginado como
`/clientes`.

```jsonc
[
  {
    "_id": "6a9f1ead4db41c583b68cf46",
    "nombre": "Pantalón",
    "descripcion": "Largos y de vestir",
    "activo": true,
    "administrador": "6a99e1a758f23da1ae1ea9b8",
    "createdAt": "2026-09-07T20:29:33.446Z",
    "updatedAt": "2026-09-07T20:29:33.446Z"
  }
]
```

Dos detalles que cambian cómo se arma la pantalla:

- **Vienen también las inactivas.** No hay filtro por `activo` en el backend: si
  querés mostrar solo las activas, filtralas en el front. En el selector del
  ticket mostrá solo `activo: true`; en la pantalla de especies mostrá todas,
  con las inactivas en gris.
- **El orden es el de MongoDB, no el del idioma.** Ordena por bytes: mayúsculas
  antes que minúsculas, y los acentos al final.

  ```
  Remera · Zapatilla · Ácido · abrigo     ← lo que devuelve la API
  abrigo · Ácido · Remera · Zapatilla     ← lo que espera ver una persona
  ```

  Reordenalo en el front con `localeCompare` (está resuelto en el servicio de
  más abajo).

`descripcion` es opcional: si no se cargó, **la clave no viene** en la
respuesta. En TypeScript va como `descripcion?: string`.

## POST /especies

```jsonc
{
  "nombre": "Pantalón",              // requerido, único en el negocio
  "descripcion": "Largos y de vestir" // opcional
}
```

Responde `201` con la especie creada, ya con `activo: true`.

> **`activo` se ignora en el alta.** Mandar `{ "activo": false }` no tiene
> efecto: toda especie nace activa. Para desactivarla hay que hacer el `PUT`
> después. Lo mismo con `administrador`: sale del token, nunca del body.

| Error | Status | Respuesta |
| --- | --- | --- |
| Falta `nombre` (o body vacío) | `400` | `{ error: "Datos inválidos", detalles: { nombre: "Path \`nombre\` is required." } }` |
| Nombre repetido en el negocio | `409` | `{ error: "Ya existe un registro con ese nombre" }` |

## PUT /especies/:id

**Parcial**: mandá solo lo que cambió. Lo que no mandes queda como está —
editar el nombre no borra la descripción.

Acepta tres campos: `nombre`, `descripcion` y `activo`.

```jsonc
{ "nombre": "Pantalones" }     // renombrar
{ "activo": false }            // desactivar (o true para volver a activarla)
{ "descripcion": "" }          // limpiar la descripción: string vacío, no null
```

Responde `200` con la especie actualizada.

| Error | Status | Respuesta |
| --- | --- | --- |
| `nombre` vacío | `400` | `{ error: "Datos inválidos", detalles: { nombre: "Path \`nombre\` is required." } }` |
| El nombre nuevo ya lo tiene otra | `409` | `{ error: "Ya existe un registro con ese nombre" }` |
| No existe, o es de otro negocio | `404` | `{ error: "Especie no encontrada" }` |
| Id mal formado (`/especies/pepe`) | `400` | `{ error: 'El valor de "_id" no es válido' }` |

> **Renombrar no reescribe los tickets viejos.** Cada ítem guardó el nombre que
> la especie tenía ese día. Es a propósito: el ticket es un comprobante de lo
> que pasó, no una vista que cambia con el tiempo. Las métricas agrupan por
> `_id`, así que el renombre sí se refleja ahí.

## DELETE /especies/:id

Borrado **real**, y solo cuando no la nombra ningún ticket ni ningún producto de
la lista de precios.

```jsonc
// 200
{ "mensaje": "Especie eliminada" }
```

| Error | Status | Respuesta |
| --- | --- | --- |
| La usa algún ticket | `400` | `{ error: "No se puede borrar: hay 2 ticket(s) con mercadería de esta especie. Desactivala en su lugar.", detalles: { tickets: 2, productos: 0 } }` |
| La usa la lista de precios | `400` | `{ error: "No se puede borrar: hay 3 producto(s) de esta especie en la lista de precios. Desactivala en su lugar.", detalles: { tickets: 0, productos: 3 } }` |
| No existe, o es de otro negocio | `404` | `{ error: "Especie no encontrada" }` |
| Id mal formado | `400` | `{ error: 'El valor de "especie" no es válido' }` |

Dos cosas del 400:

- **`error` ya viene redactado para mostrárselo al usuario**, con el número
  adentro. No hace falta armar el mensaje.
- **`detalles` trae los dos conteos**, por si querés ofrecer "ver los tickets"
  además de desactivar.

> El mensaje del id mal formado dice `"especie"` y no `"_id"` como en el resto
> de los endpoints. **No parsees el nombre del campo**, mostrá `error` y listo.

---

## Cómo se usa en el ticket

Es el motivo por el que existe esta pantalla, así que conviene tenerlo a la
vista. El detalle completo va en la guía de tickets; acá está lo mínimo.

`POST /clientes/:id/tickets`

```jsonc
{
  "items": [
    {
      "nombre": "Pantalón largo",   // requerido, lo escribe el administrador
      "talle": "34",                // opcional, texto libre ("34", "M", "XL")
      "especie": "6a9f1e...",       // requerido, _id de una especie SUYA
      "cantidad": 1,                // opcional, default 1, entero ≥ 1
      "precioUnitario": 50000       // requerido, ≥ 0
    }
  ],
  "pagado": 9000                    // opcional, lo que deja en el momento
}
```

El backend calcula `subtotal` y `total`, copia `especieNombre` dentro del ítem y
pega el ticket a la factura abierta del cliente.

| Error | Status | Respuesta |
| --- | --- | --- |
| `items` vacío o ausente | `400` | `{ error: "El ticket necesita al menos un ítem" }` |
| Ítem sin nombre | `400` | `{ error: "El ítem 1 necesita un nombre" }` |
| Especie ausente, inexistente o de otro negocio | `400` | `{ error: "El ítem 1 necesita una especie de tu lista" }` |
| Cantidad 0, negativa o decimal | `400` | `{ error: 'Cantidad inválida en "Pantalón largo"' }` |
| Precio ausente o negativo | `400` | `{ error: 'Precio inválido en "Pantalón largo"' }` |
| Pagó más que el total del ticket | `400` | `{ error: "Pagó más de lo que suma el ticket", detalles: { totalTicket, pagado } }` |

**Los ítems se numeran por posición** (`El ítem 2 necesita un nombre`) porque
justo cuando falta el nombre no hay nada mejor con qué nombrarlos. Si el
formulario tiene varios renglones, resaltá el que dice el mensaje.

**Si un renglón falla no se guarda nada**: la validación corre entera antes de
tocar la base.

---

## El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](README-FRONTEND.md), que ya
resuelve el token y convierte los errores en `ApiError`.

```ts
// src/api/especies.service.ts
import { request } from "./client";

export interface Especie {
  _id: string;
  nombre: string;
  descripcion?: string;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Lo que manda el formulario, al crear y al editar. */
export interface DatosEspecie {
  nombre: string;
  descripcion?: string;
}

/**
 * La API ordena por bytes: "Zapatilla" antes que "abrigo", y los acentos al
 * final. Reordenamos acá para que la lista se lea como una lista.
 */
function porNombre(a: Especie, b: Especie): number {
  return a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
}

export const especiesService = {
  /** Todas, activas e inactivas. Filtrá vos según la pantalla. */
  async listar(): Promise<Especie[]> {
    const especies = await request<Especie[]>("/especies");
    return especies.sort(porNombre);
  },

  /** Las que se pueden elegir al cargar un ticket. */
  async listarActivas(): Promise<Especie[]> {
    return (await this.listar()).filter((e) => e.activo);
  },

  /** Nace siempre activa: mandar `activo` acá no tiene efecto. */
  crear(datos: DatosEspecie) {
    return request<Especie>("/especies", { method: "POST", body: datos });
  },

  /** Parcial: los campos ausentes quedan como están, no se borran. */
  editar(id: string, cambios: Partial<DatosEspecie>) {
    return request<Especie>(`/especies/${id}`, { method: "PUT", body: cambios });
  },

  /** El interruptor de la lista. Es el mismo PUT. */
  cambiarActivo(id: string, activo: boolean) {
    return request<Especie>(`/especies/${id}`, { method: "PUT", body: { activo } });
  },

  /** Falla con 400 si algún ticket la usa. Ver `borrarODesactivar`. */
  eliminar(id: string) {
    return request<{ mensaje: string }>(`/especies/${id}`, { method: "DELETE" });
  },
};
```

### Alta, con el 409 en su campo

```ts
try {
  const especie = await especiesService.crear({ nombre });
  setEspecies((prev) => [...prev, especie]);
  cerrarModal();
} catch (e) {
  if (!(e instanceof ApiError)) throw e;

  // 400 → detalles = { nombre: "Path `nombre` is required." }
  setErroresPorCampo(e.detalles ?? {});

  // 409 → el nombre ya existe: va bajo ESE campo, no como error general
  if (e.status === 409) setErroresPorCampo({ nombre: "Ya tenés una especie con ese nombre" });
}
```

### Borrar, con la salida por desactivar

Es lo único que separa esta pantalla de un CRUD cualquiera. El 400 no es un
error para mostrar y olvidar: es una pregunta.

```ts
async function borrarODesactivar(especie: Especie) {
  if (!confirm(`¿Borrar "${especie.nombre}"?`)) return;

  try {
    await especiesService.eliminar(especie._id);
    setEspecies((prev) => prev.filter((e) => e._id !== especie._id));
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 400) throw e;

    // Está en uso. El mensaje del backend ya viene redactado y con el número.
    if (!confirm(`${e.message}\n\n¿La desactivo?`)) return;

    const actualizada = await especiesService.cambiarActivo(especie._id, false);
    setEspecies((prev) => prev.map((e2) => (e2._id === actualizada._id ? actualizada : e2)));
  }
}
```

### En el formulario del ticket

Es el otro lugar donde se usa: el selector de especie de cada renglón, con las
activas nomás.

```ts
const [especies, setEspecies] = useState<Especie[]>([]);
useEffect(() => { especiesService.listarActivas().then(setEspecies); }, []);
```

Si vuelve vacío, **no muestres un select vacío**: el administrador no tiene forma
de adivinar que primero hay que crear una especie. Mostrá el acceso a esta
pantalla, o dejá crear una ahí mismo (son dos campos).

---

## Checklist de la pantalla

### Listado
- [ ] Una fila por especie: nombre, descripción y estado
- [ ] Ordenar con `localeCompare`, no confiar en el orden de la API
- [ ] Inactivas visibles pero en gris, o detrás de un toggle "ver inactivas"
- [ ] Interruptor de activa/inactiva en la fila, sin entrar a editar
- [ ] **Estado vacío que empuje a crear la primera**: es lo primero que ve un
      negocio recién dado de alta, y sin especies no se puede cargar un ticket
- [ ] Sugerir nombres al arrancar (Pantalón, Pantalón corto, Remera, Zapatilla,
      Media, Campera) para que la lista inicial sea un par de clicks
- [ ] Avisar si la lista se hace larga: son categorías, no productos

### Alta y edición
- [ ] Un modal alcanza: son dos campos
- [ ] `nombre` obligatorio, validado antes de enviar
- [ ] El 409 va bajo el campo nombre
- [ ] En edición, precargar y mandar solo lo que cambió
- [ ] Para limpiar la descripción mandar `""`, no `null`

### Borrado
- [ ] Confirmación antes del DELETE
- [ ] Al 400, ofrecer desactivar en vez de mostrar el error suelto
- [ ] Usar el `error` del backend tal cual: ya viene con el número

### Integración con el ticket
- [ ] El selector de cada renglón usa solo las activas
- [ ] Si no hay ninguna, acceso a esta pantalla en vez de un select vacío
- [ ] Poder crear una especie sin salir del ticket (son dos campos)
