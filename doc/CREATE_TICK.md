# El ticket — CRUD completo

La pantalla más importante de la app: el administrador tiene al cliente
enfrente y anota lo que se lleva. Acá está **el ciclo completo del ticket**:
crearlo, leerlo, corregirlo y anularlo.

Los pagos a cuenta y el cierre de la factura van en otra guía; para ver la
factura con sus tickets, [FACTURAS.md](FACTURAS.md).

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

## Qué es un ticket

**Una visita.** "Jueves: se llevó un pantalón y tres medias, dejó $9.000."

No es un remito ni una factura fiscal: es el renglón de la libreta. Lo que
importa de él es el **faltante** — lo que quedó debiendo — porque eso es lo
único que suma a la cuenta del cliente.

```
total del ticket   $59.000     lo que se llevó
dejó en el momento $ 9.000     el "pagado"
─────────────────────────
faltante           $50.000     ← esto va a la cuenta
```

## Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `POST` | `/clientes/:id/tickets` | Cargar la compra |
| `GET` | `/tickets/:id` | Leer uno |
| `PUT` | `/tickets/:id` | Corregirlo |
| `DELETE` | `/tickets/:id` | Anularlo (**baja lógica**) |

**Editar y anular solo se puede mientras la factura sigue abierta.** Una vez
cerrada ya tiene número y el cliente vio ese resumen: cambiarle los renglones
por atrás reescribiría algo que ya se comunicó.

## Lo único que tiene que existir antes

1. **El cliente.** Ya tiene su factura abierta: se le abrió sola al crearlo.
2. **Al menos una especie.** Ver [ESPECIES.md](ESPECIES.md).

**No hay que cargar productos.** El ítem se escribe acá, en el momento: nombre,
talle y precio del día. No hay inventario ni stock que mantener.

---

## POST /clientes/:id/tickets

```jsonc
{
  "items": [
    {
      "nombre": "Pantalón largo",   // requerido
      "talle": "34",                // opcional, texto libre: "34", "M", "XL"
      "especie": "6aa017b...",      // requerido, _id de una especie SUYA
      "cantidad": 1,                // opcional, default 1. Entero ≥ 1
      "precioUnitario": 50000       // requerido, ≥ 0
    },
    {
      "nombre": "Media deportiva",
      "talle": "M",
      "especie": "6aa017b...",
      "cantidad": 3,
      "precioUnitario": 3000
    }
  ],
  "pagado": 9000                    // opcional, default 0. Lo que deja hoy
}
```

| Campo | Requerido | Regla |
| --- | --- | --- |
| `items` | sí | Al menos uno |
| `items[].nombre` | sí | No puede quedar vacío. Se le hace trim |
| `items[].especie` | sí | Tiene que ser una especie del negocio |
| `items[].precioUnitario` | sí | Número ≥ 0 |
| `items[].cantidad` | no | Default `1`. Entero ≥ 1 (no acepta 1.5) |
| `items[].talle` | no | Texto libre. Se le hace trim |
| `pagado` | no | Default `0`. Entre 0 y el total del ticket |

El backend calcula `subtotal` de cada renglón y el `total`, copia el nombre de
la especie adentro del ítem y pega el ticket a la factura abierta del cliente.

### La respuesta — `201`

```jsonc
{
  "ticket": {
    "_id": "6aa0185ab32e1f350d473169",
    "factura": "6a9ee25e4db41c583b68cef4",
    "cliente": "6a9ee25e4db41c583b68cef2",
    "fecha": "2026-09-08T14:14:50.285Z",
    "items": [
      {
        "nombre": "Pantalón largo",
        "talle": "34",
        "especie": "6aa017b6e2dbd95dbd8a7448",
        "especieNombre": "Pantalón",    // ← copiado, para mostrar sin buscar
        "cantidad": 1,
        "precioUnitario": 50000,
        "subtotal": 50000
      },
      { "nombre": "Media deportiva", "talle": "M", "especieNombre": "Media",
        "cantidad": 3, "precioUnitario": 3000, "subtotal": 9000 }
    ],
    "total": 59000,
    "pagado": 9000,
    "faltante": 50000               // ← calculado, no hay que restar
  },
  "factura": {
    "_id": "6a9ee25e4db41c583b68cef4",
    "estado": "abierta",
    "estadoVisible": "abierta",
    "venceEl": "2026-09-11T02:59:59.999Z",
    "diasParaVencer": 3,
    "cantidadTickets": 1,
    "totalMercaderia": 59000,
    "totalPagadoEnTickets": 9000,
    "totalFiado": 50000,
    "totalPagos": 0,
    "saldo": 50000
  },
  "warning": null
}
```

Vienen las tres cosas que la pantalla necesita después de guardar: el ticket
para mostrarlo, **la factura con el saldo ya recalculado** (no hace falta
volver a pedirla) y el aviso de límite si corresponde.

### Los cinco totales de la factura

Confunden si no se leen en orden. Son del **período entero**, no de este ticket:

| Campo | Qué es |
| --- | --- |
| `totalMercaderia` | Todo lo que se llevó |
| `totalPagadoEnTickets` | Lo que fue dejando en cada visita |
| `totalFiado` | La diferencia: lo que se anotó |
| `totalPagos` | Pagos a cuenta, aparte de los tickets |
| `saldo` | `totalFiado − totalPagos`. **Es el número que se muestra** |

---

## Dos cosas que sorprenden

### 1. La factura que vuelve puede no ser la que tenías en pantalla

El ticket se pega **solo** a la factura abierta del cliente. Pero si esa factura
ya venció y tenía movimiento, el backend la cierra, le da número y abre la del
período siguiente — todo dentro de este mismo request.

```
factura #12 abierta, venció el 10          ← lo que mostraba tu pantalla
       ↓  llega un ticket el día 14
factura #12 cerrada  +  factura nueva abierta con el ticket adentro
```

**Usá siempre la `factura` que devuelve la respuesta**, no la que tenías
cargada. Si comparás `_id` y cambió, el período se renovó: conviene avisarlo
("se abrió el período nuevo") y refrescar la vista del cliente.

Esto no lo dispara ningún cron: se resuelve cuando alguien toca la cuenta, así
que no depende de que el server haya estado prendido a medianoche.

### 2. El límite de crédito avisa, no bloquea

Si el cliente tiene `limiteCredito > 0` y el **saldo de la factura** queda por
encima, la respuesta trae:

```jsonc
{ "warning": "Ana López superó su límite de $10000" }
```

Pero el ticket **se guarda igual**, con `201`. La decisión es del dueño: la
mercadería ya salió del local, y un sistema que se niega a anotarlo solo logra
que la deuda no quede registrada.

En el front va como un cartel amarillo después de guardar, nunca como un error.

> El aviso compara contra el saldo de **esa** factura, no contra la deuda total
> del cliente. Si arrastra saldo de períodos anteriores, la deuda puede pasar el
> límite sin que salte el warning.

---

## Errores del alta

Todos son `400` salvo los del cliente. Verificados uno por uno contra la API.

| Caso | Status | `error` |
| --- | --- | --- |
| `items` vacío o ausente | 400 | `El ticket necesita al menos un ítem` |
| Ítem sin nombre | 400 | `El ítem 1 necesita un nombre` |
| Especie ausente, inexistente o de otro negocio | 400 | `El ítem 1 necesita una especie de tu lista` |
| Cantidad 0, negativa o decimal | 400 | `Cantidad inválida en "Pantalón largo"` |
| Precio ausente, negativo o no numérico | 400 | `Precio inválido en "Pantalón largo"` |
| `pagado` negativo | 400 | `El monto pagado no puede ser negativo` |
| `pagado` mayor al total | 400 | `Pagó más de lo que suma el ticket` + `detalles: { totalTicket, pagado }` |
| Cliente de otro negocio o inexistente | 404 | `Cliente no encontrado` |
| Id de cliente mal formado | 400 | `El valor de "_id" no es válido` |

**Si un renglón falla no se guarda nada.** La validación corre entera antes de
tocar la base, así que no quedan tickets a medias.

**Los renglones se numeran por posición** (`El ítem 2 necesita un nombre`)
porque justo cuando falta el nombre no hay nada mejor con qué nombrarlos.

> **Validá en el front antes de enviar.** Las reglas son simples y así el
> administrador ve el error en el renglón, mientras escribe, en vez de después
> de tocar guardar. Dejá el mensaje del backend como red de seguridad, en un
> cartel arriba del formulario.

---

## GET /tickets/:id

Devuelve el ticket solo, sin la factura. Sirve para abrir uno por link directo o
para recargar la pantalla de edición.

```jsonc
{
  "_id": "6aa0185ab32e1f350d473169",
  "factura": "6a9ee25e...",
  "cliente": "6a9ee25e...",
  "fecha": "2026-09-08T14:14:50.285Z",
  "items": [ /* ... */ ],
  "total": 59000,
  "pagado": 9000,
  "faltante": 50000,
  "anulado": false,
  "anuladoEl": null,          // solo si está anulado
  "motivoAnulacion": null     // solo si se cargó uno
}
```

En la práctica el front casi siempre ya tiene el ticket: viene dentro de
`GET /facturas/:id` y de `GET /clientes/:id/factura-actual`.

| Error | Status |
| --- | --- |
| No existe, o es de otro negocio | `404` `{ error: "Ticket no encontrado" }` |
| Id mal formado | `400` `{ error: 'El valor de "_id" no es válido' }` |

---

## PUT /tickets/:id — corregir

**Reemplaza los renglones completos, no los parchea de a uno.** El formulario ya
tiene el ticket entero cargado, así que manda el estado final; un merge por
índice haría que borrar el segundo renglón dependiera de mandar bien los otros.

```jsonc
{
  "items": [                       // requerido, mismas reglas que el alta
    { "nombre": "Pantalón cargo", "talle": "36", "especie": "6aa017b...",
      "cantidad": 1, "precioUnitario": 25000 },
    { "nombre": "Media", "talle": "M", "especie": "6aa017b...",
      "cantidad": 2, "precioUnitario": 5000 }
  ],
  "pagado": 10000                  // opcional: si no va, conserva el que tenía
}
```

Responde `200` con **la misma forma que el alta**: `{ ticket, factura, warning }`,
con la factura ya recalculada. La pantalla de edición y la de alta comparten el
manejo de la respuesta.

### El `pagado` cuando el ticket se achica

Si no mandás `pagado`, se conserva el anterior. Pero si además achicaste el
ticket y el viejo `pagado` ya no entra, es un `400`:

```jsonc
// tenía pagado 10000 y lo dejás en un solo ítem de 3000
{ "error": "Pagó más de lo que suma el ticket",
  "detalles": { "totalTicket": 3000, "pagado": 10000 } }
```

Es a propósito: guardar eso dejaría un ticket donde el cliente dejó más plata de
la que se llevó en mercadería. Cuando el front achica el ticket tiene que
mandar el `pagado` nuevo, o bajarlo a `0`.

---

## DELETE /tickets/:id — anular

**Es baja lógica.** El ticket no se borra: queda guardado con `anulado: true` y
deja de sumar a la factura.

```jsonc
// body opcional
{ "motivo": "lo cargué en el cliente equivocado" }
```

```jsonc
// 200
{
  "mensaje": "Ticket anulado",
  "ticket": {
    "_id": "...", "total": 35000, "pagado": 10000, "faltante": 25000,
    "anulado": true,
    "anuladoEl": "2026-09-08T14:33:39.402Z",
    "motivoAnulacion": "lo cargué en el cliente equivocado"
  },
  "factura": { /* recalculada: ya no cuenta este ticket */ }
}
```

### Qué significa "no suma" exactamente

El ticket **conserva sus propios números** (`total`, `pagado`, `faltante`): son
lo que se anotó ese día. Lo que cambia es que la factura lo saltea al recalcular.

```
antes de anular      saldo $37.000   ·   cantidadTickets 2
después de anular    saldo $12.000   ·   cantidadTickets 1
```

**Y sigue viniendo en las listas.** `GET /facturas/:id` y `factura-actual`
devuelven los anulados junto con los activos, cada uno con su bandera:

```
[ANULADO] $35000   Pantalón cargo      ← el front lo tacha
[activo ] $12000   Campera
saldo de la factura: 12000
```

Se anota en una libreta: lo que se escribió mal se cruza con una raya, no se
arranca la hoja. Además, un ticket borrado de verdad se lleva la explicación de
por qué la cuenta del cliente cambió de un día para el otro.

> **No hay "desanular".** Si se anuló por error, se carga el ticket de nuevo.
> Se puede agregar si en la práctica hace falta.

---

## Errores de la edición y la anulación

Además de todos los del alta, que valen igual para el `PUT`:

| Caso | Status | `error` |
| --- | --- | --- |
| El ticket ya estaba anulado | 400 | `El ticket ya está anulado` |
| Su factura está cerrada | 400 | `No se puede modificar un ticket de una factura cerrada` + `detalles: { estadoFactura }` |
| Su factura está pagada | 400 | `No se puede modificar un ticket de una factura pagada` |
| No existe, o es de otro negocio | 404 | `Ticket no encontrado` |
| Id mal formado | 400 | `El valor de "_id" no es válido` |

**Los dos primeros son la misma regla:** un ticket se toca mientras su factura
sigue abierta. Después queda congelado.

En el front eso significa: los botones de editar y anular **solo se muestran si
`factura.estado === "abierta"`**. Si igual llega el 400, mostrá el mensaje del
backend, que ya viene redactado.

---

## El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](README-FRONTEND.md).

```ts
// src/api/tickets.service.ts
import { request } from "./client";

/** Un renglón, como lo escribe el administrador. */
export interface ItemNuevo {
  nombre: string;
  talle?: string;
  /** _id de una especie del negocio. */
  especie: string;
  cantidad?: number;
  precioUnitario: number;
}

export interface TicketNuevo {
  items: ItemNuevo[];
  /** Lo que deja en el momento. 0 = se fía todo. */
  pagado?: number;
}

/** Un renglón como vuelve: con el subtotal y el nombre de la especie resueltos. */
export interface ItemTicket {
  nombre: string;
  talle?: string;
  especie: string;
  especieNombre: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
}

export interface Ticket {
  _id: string;
  factura: string;
  cliente: string;
  fecha: string;
  items: ItemTicket[];
  total: number;
  pagado: number;
  /** total − pagado. Lo que se anotó en la cuenta. */
  faltante: number;
  /** Anulado: conserva sus números pero no suma a la factura. */
  anulado: boolean;
  anuladoEl?: string;
  motivoAnulacion?: string;
}

export interface Factura {
  _id: string;
  estado: "abierta" | "cerrada" | "pagada" | "anulada";
  estadoVisible: string;
  venceEl: string;
  diasParaVencer: number;
  cantidadTickets: number;
  totalMercaderia: number;
  totalPagadoEnTickets: number;
  totalFiado: number;
  totalPagos: number;
  saldo: number;
}

export interface RespuestaTicket {
  ticket: Ticket;
  /** La factura con el saldo ya recalculado. Puede ser una NUEVA. */
  factura: Factura;
  /** Aviso de límite de crédito. El ticket se guardó igual. */
  warning: string | null;
}

/** El total, para mostrarlo mientras se escribe. El backend lo recalcula igual. */
export function totalDe(items: ItemNuevo[]): number {
  return items.reduce((t, i) => t + (i.precioUnitario || 0) * (i.cantidad || 1), 0);
}

export interface RespuestaAnulacion {
  mensaje: string;
  ticket: Ticket;
  factura: Factura;
}

export const ticketsService = {
  crear(clienteId: string, ticket: TicketNuevo) {
    return request<RespuestaTicket>(`/clientes/${clienteId}/tickets`, {
      method: "POST",
      body: ticket,
    });
  },

  detalle(id: string) {
    return request<Ticket>(`/tickets/${id}`);
  },

  /**
   * Reemplaza los renglones completos: mandá el ticket como quedó, no un parche.
   * Si achicás el total, mandá también el `pagado` nuevo.
   */
  editar(id: string, ticket: TicketNuevo) {
    return request<RespuestaTicket>(`/tickets/${id}`, { method: "PUT", body: ticket });
  },

  /** Baja lógica: queda tachado, no desaparece. */
  anular(id: string, motivo?: string) {
    return request<RespuestaAnulacion>(`/tickets/${id}`, {
      method: "DELETE",
      body: motivo ? { motivo } : undefined,
    });
  },
};

/** Editar y anular solo mientras la factura sigue abierta. */
export function sePuedeTocar(ticket: Ticket, factura: { estado: string }): boolean {
  return !ticket.anulado && factura.estado === "abierta";
}
```

### Validar antes de enviar

Las mismas reglas del backend, para mostrarlas en el renglón:

```ts
export function validarItem(item: ItemNuevo): string | null {
  if (!item.nombre?.trim()) return "Poné qué se lleva";
  if (!item.especie) return "Elegí la especie";
  if (!(item.precioUnitario >= 0)) return "Falta el precio";
  if (item.cantidad !== undefined && !Number.isInteger(item.cantidad)) {
    return "La cantidad va entera";
  }
  if ((item.cantidad ?? 1) < 1) return "La cantidad va de 1 para arriba";
  return null;
}
```

### Anular, con confirmación

```ts
async function anular(ticket: Ticket) {
  const motivo = await pedirMotivo();      // opcional, un input alcanza
  if (motivo === null) return;             // canceló

  try {
    const { factura } = await ticketsService.anular(ticket._id, motivo);
    setFactura(factura);                   // ya viene sin ese ticket sumado
    marcarAnulado(ticket._id);             // en la lista queda tachado
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    setErrorGeneral(e.message);            // "El ticket ya está anulado", etc.
  }
}
```

### Guardar — alta y edición comparten todo

Las dos responden `{ ticket, factura, warning }`, así que es el mismo código con
distinto llamado:

```ts
async function guardar() {
  const errores = items.map(validarItem);
  if (errores.some(Boolean)) return setErroresPorFila(errores);

  const total = totalDe(items);
  if (pagado > total) return setErrorPagado("Está dejando más de lo que suma");

  try {
    const { ticket, factura, warning } = editando
      ? await ticketsService.editar(editando._id, { items, pagado })
      : await ticketsService.crear(clienteId, { items, pagado });

    // La factura puede ser otra: si venció, el backend cerró la vieja y abrió una.
    if (factura._id !== facturaEnPantalla?._id) {
      avisar("Se cerró el período anterior y se abrió uno nuevo");
    }

    setFactura(factura);
    if (warning) avisarAmarillo(warning);   // se guardó igual, no es un error
    router.replace(`/clientes/${clienteId}`);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    setErrorGeneral(e.message);   // ya viene redactado para mostrar
  }
}
```

---

## La pantalla

El formulario es una **lista de renglones que crece**, no un formulario fijo.
El administrador está de pie, con el cliente enfrente: cada toque cuenta.

```
┌────────────────────────────────────────────────┐
│  Ticket para Ana López            deuda $18.000│
├────────────────────────────────────────────────┤
│  1  [Pantalón largo    ] [34 ] [Pantalón  ▾]   │
│     cant [1 ]  precio [50000]      $50.000  🗑  │
│                                                │
│  2  [Media deportiva   ] [M  ] [Media     ▾]   │
│     cant [3 ]  precio [ 3000]      $ 9.000  🗑  │
│                                                │
│  + Agregar otro                                │
├────────────────────────────────────────────────┤
│  Total                              $59.000    │
│  Deja ahora        [    9000 ]                 │
│  Queda debiendo                     $50.000    │
├────────────────────────────────────────────────┤
│            [ Cancelar ]  [ Guardar ticket ]    │
└────────────────────────────────────────────────┘
```

### Checklist

**El formulario**
- [ ] Arranca con un renglón vacío y el foco puesto en "qué se lleva"
- [ ] "Agregar otro" suma un renglón; el nuevo hereda la especie del anterior
      (lo más común es llevarse dos cosas parecidas)
- [ ] `cantidad` arranca en 1: es lo que más se repite
- [ ] Teclado numérico en cantidad y precio
- [ ] Borrar renglón, con el último no borrable
- [ ] El selector de especie usa solo las activas (`especiesService.listarActivas()`)
- [ ] Si no hay especies, link a esa pantalla en vez de un select vacío

**Los números**
- [ ] Subtotal por renglón, actualizado mientras escribe
- [ ] Total abajo, siempre visible
- [ ] "Deja ahora" con un botón de "pagó todo" que lo iguala al total
- [ ] "Queda debiendo" = total − deja, en grande: **es el número del negocio**
- [ ] Formatear en pesos, sin decimales

**Al guardar**
- [ ] Validar en el front y marcar el renglón que falla
- [ ] Bloquear el botón mientras va el request (dos toques = dos tickets)
- [ ] `warning` va en amarillo, después de guardar: **no es un error**
- [ ] Si `factura._id` cambió, avisar que se abrió un período nuevo
- [ ] Volver al detalle del cliente con el saldo ya actualizado

**Editar**
- [ ] Reusar el mismo formulario del alta, precargado con los ítems
- [ ] Mandar el ticket **completo**, no solo lo que cambió
- [ ] Si el total nuevo queda por debajo del `pagado`, ajustarlo antes de enviar
      (o el backend responde 400)
- [ ] Botón visible solo si `factura.estado === "abierta"` y el ticket no está anulado

**Anular**
- [ ] Confirmación con el total del ticket a la vista
- [ ] Pedir el motivo, opcional pero útil para entender la cuenta después
- [ ] El ticket anulado **queda en la lista, tachado y en gris** — no desaparece
- [ ] Mostrar el motivo y la fecha de anulación en el ticket tachado
- [ ] Actualizar el saldo con la `factura` que devuelve la respuesta
- [ ] No hay deshacer: si se anuló por error, se carga de nuevo

**Lo que no hay que hacer**
- [ ] No pedir confirmación con un modal: hace más lento el caso normal
- [ ] No bloquear por límite de crédito: el backend ya decidió que avisa nomás
- [ ] No pedir la factura de nuevo: viene en la respuesta

---

## Probarlo por consola

```bash
TOKEN=...        # el que devuelve POST /auth/login
CLIENTE=6a9ee25e4db41c583b68cef2
ESPECIE=6aa017b6e2dbd95dbd8a7448     # GET /especies para ver los ids

curl -X POST http://localhost:4000/clientes/$CLIENTE/tickets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
        "items": [
          {"nombre":"Pantalón largo","talle":"34","especie":"'$ESPECIE'","cantidad":1,"precioUnitario":50000}
        ],
        "pagado": 9000
      }'
```

Corregirlo, anularlo y ver cómo quedó la cuenta:

```bash
# editar: se manda el ticket entero, como quedó
curl -X PUT http://localhost:4000/tickets/$TICKET \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"items":[{"nombre":"Pantalón cargo","talle":"36","especie":"'$ESPECIE'","cantidad":1,"precioUnitario":25000}],"pagado":5000}'

# anular (baja lógica: queda tachado, no se borra)
curl -X DELETE http://localhost:4000/tickets/$TICKET \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"motivo":"lo cargué en el cliente equivocado"}'

# la cuenta, con los anulados marcados
curl http://localhost:4000/clientes/$CLIENTE/factura-actual -H "Authorization: Bearer $TOKEN"
```
