# Backlog

El orden en que se construye la app, siguiendo el flujo real del administrador.
Cada etapa se detalla **cuando llegamos a ella**, no antes.

- ✅ hecho y probado · 🔨 en curso · ⬜ pendiente · 📄 falta documentar

---

## El mapa

El administrador no puede facturar sin tickets, ni cargar un ticket sin tener
al menos una especie, ni nada de eso sin un cliente. El orden no es opcional —
pero es más corto de lo que era: **el 08/09 se sacó el inventario del medio**.
No hay que dar de alta productos para poder vender.

```
1. CLIENTES        crear, listar, ver, editar, borrar
       ↓
2. ESPECIES        Pantalón, Pantalón corto, Zapatilla, Media…
       ↓
3. TICKETS         el cliente se lleva mercadería fiada: el ítem se escribe
                   ahí mismo (nombre, talle, precio) y se le elige la especie
       ↓
5. FACTURA         se arma sola con los tickets del período
       ↓
6. COBRANZA        pagos, vencidas, avisos
       ↓
7. MÉTRICAS        qué se vende más, quién debe más
```

## Estado por etapa

| # | Etapa | Backend | Documentado | Front |
| --- | --- | --- | --- | --- |
| 1 | Clientes | ✅ | ✅ | 🔨 servicio listo, faltan pantallas |
| 2 | Especies | ✅ | ✅ | 🔨 servicio listo, faltan pantallas |
| 3 | Tickets | ✅ | ✅ CRUD completo | 🔨 |
| 4 | Factura | ✅ | ✅ lectura | ⬜ |
| 5 | Cobranza | 🔨 | ⬜ | ⬜ |
| 6 | Métricas | ⬜ | ⬜ | ⬜ |

> El backend de las etapas 3 a 5 ya está escrito y probado, pero **sin
> documentar**. Se documenta cuando le toque el turno a cada una, para no
> escribir guías de cosas que todavía pueden cambiar.

---

## Inventario: todo lo que ya existe en el backend

Está **escrito y probado**, pero solo lo marcado con ✅ tiene documentación
detallada. El resto funciona; simplemente todavía no le tocó el turno.

Leyenda: ✅ detallado acá · 📘 documentado en otra guía · ⬜ sin documentar

### Autenticación — 8 endpoints

| | Endpoint | Qué hace |
| --- | --- | --- |
| 📘 | `POST /auth/registro` | Crea cuenta de administrador |
| 📘 | `POST /auth/login` | |
| 📘 | `POST /auth/google` | Login con Google (Expo) |
| 📘 | `GET /auth/me` | Rehidratar sesión |
| 📘 | `POST /auth/recuperar-password` | Paso 1 de recuperación |
| 📘 | `GET /auth/recuperar-password/:token` | Paso 2, validar el link |
| 📘 | `POST /auth/resetear-password` | Paso 3 |
| 📘 | `POST /auth/cambiar-password` | Con sesión iniciada |

📘 en [README-FRONTEND.md](README-FRONTEND.md) y [GOOGLE_AUTH.md](GOOGLE_AUTH.md).

### Clientes — 4 endpoints · Etapa 1

| | Endpoint |
| --- | --- |
| ✅ | `POST /clientes` |
| ✅ | `GET /clientes` |
| ✅ | `GET /clientes/:id` |
| ✅ | `PUT /clientes/:id` |

### Especies — 4 endpoints · Etapa 2

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `GET /especies` | Los tipos: Pantalón, Pantalón corto, Zapatilla, Media |
| ✅ | `POST /especies` | |
| ✅ | `PUT /especies/:id` | También sirve para desactivar |
| ✅ | `DELETE /especies/:id` | Rechaza si algún ticket la nombra |

📄 [ESPECIES.md](ESPECIES.md) — la guía de la sección, lista para aplicar.

> Antes se llamaba **catálogo** y vivía en `/catalogos`. Se renombró el 08/09,
> junto con sacar el inventario del medio. La migración de datos está en
> [scripts/migrar-especies.mjs](../scripts/migrar-especies.mjs).

### Productos — 5 endpoints · fuera del flujo

**Ya no hacen falta para vender.** El ítem del ticket se escribe a mano, así que
estos endpoints quedaron como una lista de precios opcional, para prellenar el
formulario. Su campo `catalogo` pasó a llamarse `especie`.

| | Endpoint | Qué hace |
| --- | --- | --- |
| ⬜ | `GET /productos` | Acepta `?especie=` para filtrar por tipo |
| ⬜ | `GET /productos/:id` | |
| ⬜ | `POST /productos` | Requiere una especie válida del negocio |
| ⬜ | `PUT /productos/:id` | |
| ⬜ | `DELETE /productos/:id` | |

- [ ] **Decidir si se borran.** Hoy nadie los usa: el ticket no los mira y el
      `stock` ya no se descuenta solo. Si el front no los va a ofrecer como
      lista de precios, se sacan y queda un modelo menos.
- [ ] `PUT /productos/:id` le pasa `req.body` entero a `findOneAndUpdate`:
      mandando `administrador` se le puede regalar el producto a otro negocio.
      Arreglar o borrar la ruta.

### Tickets y pagos — 3 endpoints · Etapa 3

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `POST /clientes/:id/tickets` | La compra fiada. Ítems escritos a mano + especie |
| ✅ | `GET /tickets/:id` | Uno solo |
| ✅ | `PUT /tickets/:id` | Corregirlo. Reemplaza los renglones completos |
| ⬜ | `POST /clientes/:id/pagos` | Entrega plata a cuenta. Se imputa a la factura más vieja con saldo |
| ✅ | `DELETE /tickets/:id` | **Baja lógica.** Queda tachado y deja de sumar |

📄 [CREATE_TICK.md](CREATE_TICK.md) — el CRUD completo del ticket.

### Facturas — 6 endpoints · Etapa 5

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `GET /clientes/:id/factura-actual` | La cuenta abierta, con sus tickets y pagos |
| ✅ | `GET /clientes/:id/facturas` | Historial del cliente |
| ✅ | `GET /facturas` | Todas las del negocio. Paginado, con `?estado= ?cliente= ?vencidas= ?buscar=` |
| ✅ | `GET /facturas/vencidas` | Las que pasaron su fecha y siguen con saldo |
| ✅ | `GET /facturas/:id` | Detalle con tickets, pagos y cliente |
| ⬜ | `POST /facturas/:id/cerrar` | Cerrarla antes de que venza |
| ⬜ | `PUT /facturas/:id/pagada` | Marcarla saldada |

### Usuarios (solo super_admin) — 3 endpoints

| | Endpoint |
| --- | --- |
| ⬜ | `GET /usuarios` · `POST /usuarios` · `DELETE /usuarios/:id` |

Es administración de la plataforma, no del negocio. Fuera del flujo del
administrador, por eso no tiene etapa propia.

### Colecciones ⬜

Ninguna tiene su schema documentado todavía. Los campos de `Cliente` se pueden
deducir de la Etapa 1, pero `Factura` (estados, los cinco totales distintos),
`Ticket`, `Pago` y `Especie` no están escritos en ningún lado.

- [ ] Documentar los schemas de las colecciones, con qué significa cada campo

---

# Etapa 1 — Clientes

Todo arranca acá: sin cliente no hay a quién fiarle.

> 📄 **[CLIENTES.md](CLIENTES.md)** — la guía limpia y autocontenida de esta
> sección, lista para aplicar. Lo de acá abajo es el detalle del backlog.

Base: `http://localhost:4000` · Todos los endpoints piden
`Authorization: Bearer <token>`.

## Paso 1.1 — Crear cliente ✅

`POST /clientes`

```jsonc
{
  "nombre": "Ana López",          // requerido
  "dni": "33333333",              // requerido, único dentro del negocio
  "telefono": "1155667788",       // opcional
  "email": "ana@mail.com",        // opcional
  "direccion": "Calle 123",       // opcional
  "limiteCredito": 50000,         // opcional, default 0 (= sin límite)
  "ventanaPago": {                // opcional, default { 1, 10 }
    "desdeDia": 1,
    "hastaDia": 10
  }
}
```

**La ventana de pago es el corazón del cliente.** Define cuándo paga: uno del 1
al 10, otro del 20 al 30. De ahí sale el vencimiento de cada factura suya.

Respuesta `201`:

```jsonc
{
  "_id": "6a9d90350b11ce7547c32fdf",
  "nombre": "Ana López",
  "dni": "33333333",
  "telefono": "1155667788",
  "limiteCredito": 50000,
  "ventanaPago": { "desdeDia": 1, "hastaDia": 10 },
  "facturaAbierta": {              // ← se abre sola al crear el cliente
    "_id": "...",
    "estado": "abierta",
    "venceEl": "2026-09-11T02:59:59.999Z",
    "saldo": 0,
    "estadoVisible": "abierta",
    "diasParaVencer": 5
  }
}
```

**Al crear el cliente se le abre su primera factura automáticamente.** El
administrador no tiene que hacer nada: el primer ticket que cargue ya tiene
dónde ir.

### Errores

| Caso | Status | Respuesta |
| --- | --- | --- |
| Falta nombre | 400 | `{ error: "Datos inválidos", detalles: { nombre: "Path \`nombre\` is required." } }` |
| Falta DNI | 400 | igual, con `detalles.dni` |
| DNI repetido en el negocio | 409 | `{ error: "Ya existe un registro con ese dni" }` |
| `desdeDia` > `hastaDia` | 400 | `{ error: "El día de inicio de la ventana no puede ser posterior al de fin" }` |
| Día fuera de 1–31 | 400 | `{ error: "Los días de la ventana de pago tienen que estar entre 1 y 31" }` |

> El DNI es único **por negocio**: dos tiendas distintas pueden tener al mismo
> cliente sin pisarse.

### Para el front

- [ ] Formulario con nombre y DNI obligatorios
- [ ] Selector de ventana de pago (dos días del mes). Sugerir 1–10 por defecto
- [ ] Mostrar `detalles` bajo cada campo cuando viene un 400
- [ ] El 409 de DNI va bajo el campo DNI, no como error general

## Paso 1.2 — Listar clientes ✅

`GET /clientes`

| Query param | Default | Qué hace |
| --- | --- | --- |
| `buscar` | — | Texto en el **nombre o el DNI**, sin distinguir mayúsculas |
| `deudores` | `false` | `true` = solo los que deben |
| `vencidos` | `false` | `true` = solo los que tienen alguna factura vencida |
| `pagina` | `1` | |
| `porPagina` | `20` | Máximo 100 |

```jsonc
{
  "datos": [
    {
      "_id": "...",
      "nombre": "Ana López",
      "dni": "33333333",
      "telefono": "1155667788",
      "limiteCredito": 50000,
      "ventanaPago": { "desdeDia": 1, "hastaDia": 10 },
      "deuda": 18000,            // ← suma de TODAS sus facturas con saldo
      "facturasVencidas": 0      // ← cuántas se le pasaron de fecha
    }
  ],
  "total": 5,
  "pagina": 1,
  "porPagina": 20,
  "paginas": 1
}
```

**`deuda` y `facturasVencidas` se calculan en la misma consulta**, no están
guardados en el cliente. Un saldo denormalizado sería un segundo lugar donde
vive el mismo número y terminaría desincronizándose.

### Para el front

- [ ] Lista con nombre, DNI, teléfono y deuda
- [ ] Destacar a los que deben (`deuda > 0`)
- [ ] Alertar a los que superaron su límite (`limiteCredito > 0 && deuda > limiteCredito`)
- [ ] Marcar en rojo a los que tienen `facturasVencidas > 0`
- [ ] Buscador que pega a `?buscar=` con debounce (~300 ms)
- [ ] Scroll infinito o paginador usando `pagina` / `paginas`
- [ ] Chips de filtro: "Solo deudores", "Solo vencidos"

## Paso 1.3 — Ver detalle ✅

`GET /clientes/:id`

Lo mismo que en la lista, más su factura abierta:

```jsonc
{
  "_id": "...",
  "nombre": "Ana López",
  "deuda": 66500,
  "facturaAbierta": {
    "estado": "abierta",
    "venceEl": "2026-09-11T02:59:59.999Z",
    "saldo": 9500,
    "cantidadTickets": 1,
    "estadoVisible": "abierta",   // abierta | vencida | sin deuda | pagada
    "vencida": false,
    "diasParaVencer": 5
  }
}
```

| Caso | Status |
| --- | --- |
| No existe | 404 `{ error: "Cliente no encontrado" }` |
| Id mal formado (`/clientes/pepe`) | 400 `{ error: 'El valor de "_id" no es válido' }` |
| De otro administrador | 404 (no 403: no confirmamos que exista) |

### Para el front

- [ ] Ficha con los datos y la deuda arriba de todo
- [ ] Tarjeta de la factura abierta: saldo, vencimiento, `diasParaVencer`
- [ ] Usar `estadoVisible`, no `estado`: "vencida" se calcula y no está en `estado`
- [ ] Botones: editar, cargar ticket, registrar pago

### Falta en el backend

- [ ] Traer el **historial de facturas** en el mismo detalle, o dejarlo aparte
      (ya existe `GET /clientes/:id/facturas`)

## Paso 1.4 — Editar cliente ✅

`PUT /clientes/:id`

Acepta **actualizaciones parciales**: los campos que no mandes quedan como
están. Verificado — mandar solo `{ "limiteCredito": 99000 }` no borra el
teléfono ni la dirección.

```jsonc
{ "limiteCredito": 80000, "ventanaPago": { "desdeDia": 20, "hastaDia": 30 } }
```

Mismas validaciones que crear. Responde `200` con el cliente actualizado.

> **Ojo con cambiar la ventana de pago:** solo afecta a las facturas que se
> abran de ahí en más. La factura abierta hoy mantiene su `venceEl`. Si hace
> falta que cambie también esa, hay que decidirlo — hoy no pasa.

### Para el front

- [ ] Mismo formulario que crear, precargado
- [ ] Avisar que cambiar la ventana no mueve el vencimiento de la factura actual

## Eliminar cliente — descartado

**No se implementa.** Borrar un cliente se lleva su historial de compras y con
él las métricas de ese período. Cuando haga falta sacarlo de la lista va a ser
una baja lógica (`activo: false`), no un borrado real.

---

## El servicio del front

Va sobre el `client.ts` de [README-FRONTEND.md](README-FRONTEND.md), que ya
resuelve el token y los errores.

```ts
// src/api/clientes.service.ts
import { request } from "./client";

export interface VentanaPago {
  /** Día del mes desde el que puede pagar. */
  desdeDia: number;
  /** Día hasta el que tiene tiempo. Después, vencida. */
  hastaDia: number;
}

export interface Cliente {
  _id: string;
  nombre: string;
  dni: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  limiteCredito: number;
  ventanaPago: VentanaPago;
  createdAt: string;
  updatedAt: string;
}

/** Cliente tal como viene en el listado: con sus totales calculados. */
export interface ClienteEnLista extends Cliente {
  deuda: number;
  facturasVencidas: number;
}

/** Resumen de la factura abierta que viaja en el detalle. */
export interface FacturaAbierta {
  _id: string;
  estado: "abierta" | "cerrada" | "pagada" | "anulada";
  /** Lo que hay que mostrar: incluye "vencida", que no está en `estado`. */
  estadoVisible: string;
  venceEl: string;
  saldo: number;
  cantidadTickets: number;
  vencida: boolean;
  diasParaVencer: number;
}

export interface ClienteDetalle extends Cliente {
  deuda: number;
  facturaAbierta: FacturaAbierta | null;
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export interface FiltrosClientes {
  buscar?: string;
  deudores?: boolean;
  vencidos?: boolean;
  pagina?: number;
  porPagina?: number;
}

/** Solo manda los filtros que tienen valor: sin esto la URL se llena de vacíos. */
function armarQuery(filtros: FiltrosClientes): string {
  const params = new URLSearchParams();

  if (filtros.buscar?.trim()) params.set("buscar", filtros.buscar.trim());
  if (filtros.deudores) params.set("deudores", "true");
  if (filtros.vencidos) params.set("vencidos", "true");
  if (filtros.pagina && filtros.pagina > 1) params.set("pagina", String(filtros.pagina));
  if (filtros.porPagina) params.set("porPagina", String(filtros.porPagina));

  const query = params.toString();
  return query ? `?${query}` : "";
}

/** Lo que el formulario manda al crear o editar. */
export interface DatosCliente {
  nombre: string;
  dni: string;
  telefono?: string;
  email?: string;
  direccion?: string;
  limiteCredito?: number;
  ventanaPago?: VentanaPago;
}

export const clientesService = {
  listar(filtros: FiltrosClientes = {}) {
    return request<Pagina<ClienteEnLista>>(`/clientes${armarQuery(filtros)}`);
  },

  detalle(id: string) {
    return request<ClienteDetalle>(`/clientes/${id}`);
  },

  /** Al crear, el backend le abre la primera factura solo. */
  crear(datos: DatosCliente) {
    return request<ClienteDetalle>("/clientes", { method: "POST", body: datos });
  },

  /**
   * Actualización parcial: solo manda lo que cambió.
   * Los campos ausentes quedan como están, no se borran.
   */
  editar(id: string, cambios: Partial<DatosCliente>) {
    return request<Cliente>(`/clientes/${id}`, { method: "PUT", body: cambios });
  },
};
```

### Cómo usarlo

```ts
// Listado con buscador
const { datos, paginas } = await clientesService.listar({ buscar: texto, pagina: 1 });

// Crear, mostrando los errores por campo
try {
  const cliente = await clientesService.crear({
    nombre, dni, telefono,
    limiteCredito: 50000,
    ventanaPago: { desdeDia: 1, hastaDia: 10 },
  });
  router.push(`/clientes/${cliente._id}`);
} catch (e) {
  if (e instanceof ApiError) {
    // 400 → e.detalles = { nombre: "Path `nombre` is required." }
    // 409 → DNI repetido, va bajo el campo DNI
    setErroresPorCampo(e.detalles ?? {});
    setError(e.message);
  }
}
```

### Checklist del front

- [ ] `clientes.service.ts` copiado al proyecto
- [ ] Pantalla de listado con buscador y paginación
- [ ] Pantalla de alta con validación de nombre y DNI
- [ ] Selector de ventana de pago
- [ ] Pantalla de detalle con la deuda y la factura abierta
- [ ] Edición reusando el formulario de alta

---

## Pendientes de la Etapa 1

- [x] ~~Búsqueda por nombre/DNI en el listado~~ ✅
- [x] ~~Paginación~~ ✅
- [x] ~~Filtros: deudores, vencidos~~ ✅
- [x] ~~Servicio del front~~ ✅
- [x] ~~Decidir borrado real vs. baja lógica~~ → **no se borra**, decidido el 06/09
- [ ] Decidir si cambiar la ventana de pago debe recalcular la factura ya abierta
      (hoy solo afecta a las siguientes)

Cuando cerremos estos, pasamos a la **Etapa 2 — Especies**.

---

## Etapas siguientes

Se detallan al llegar. Por ahora solo el título y qué resuelve cada una.

### Etapa 2 — Especies ✅ documentada
Los tipos de mercadería (Pantalón, Pantalón corto, Zapatilla, Media). CRUD
completo. Es lo único que se carga antes de vender, y lo que después permite
saber qué se vende más sin importar cómo se haya escrito cada ítem.

📄 **[ESPECIES.md](ESPECIES.md)** — endpoints, errores, servicio del front y
checklist de la pantalla. Verificado contra la API el 08/09.

Pendientes:

- [ ] Pantallas del front (listado, alta/edición, borrar-o-desactivar)
- [ ] Decidir si `GET /especies` debería aceptar `?activo=true` en vez de que
      el front filtre. Hoy filtra el front

### Etapa 3 — Tickets 🔨
La compra fiada. El ítem se escribe en el momento — nombre, talle, precio — y se
le elige la especie. Se pega solo a la factura abierta del cliente. Incluye el
pago parcial ("se lleva $5000 y deja $2000").

📄 **[CREATE_TICK.md](CREATE_TICK.md)** — el CRUD completo, verificado contra la
API el 08/09: alta, lectura, edición y anulación por baja lógica, con el
servicio del front y el diseño de la pantalla.

- [x] ~~Alta~~ · ~~Edición~~ · ~~Anulación (baja lógica)~~ ✅ 08/09
- [ ] Pantallas del front (el checklist está en CREATE_TICK.md)
- [ ] Decidir si hace falta "desanular". Hoy no existe: se carga de nuevo

### Etapa 4 — Factura 🔨 lectura documentada
El resumen del período. Se arma sola. Incluye el ciclo abierta → cerrada →
pagada y el rollover al vencer.

📄 **[FACTURAS.md](FACTURAS.md)** — la vista de facturación (listado + detalle),
verificada contra la API el 08/09.

Falta documentar las acciones, que son la etapa de cobranza:
`POST /clientes/:id/pagos`, `POST /facturas/:id/cerrar`,
`PUT /facturas/:id/pagada` y `DELETE /tickets/:id`.

### Etapa 5 — Cobranza 🔨
Pagos a cuenta, listado de vencidas, avisos por WhatsApp o mail.

### Etapa 6 — Métricas ⬜
Qué se vende más, quién debe más, cuánto se fía por mes.
