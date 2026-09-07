# Sección Clientes

Todo lo necesario para armar la pantalla de clientes. Autocontenido: no hace
falta leer otro documento salvo el cliente HTTP.

- **Base:** `http://localhost:4000`
- **Auth:** todos los endpoints piden `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

> **No hay borrado de clientes.** Es a propósito: borrar un cliente se lleva su
> historial de compras y las métricas de ese período. Cuando haga falta sacarlo
> de la lista, va a ser una baja lógica.

---

## Qué es un cliente

La persona a la que se le fía. Se identifica por **DNI**, único dentro del
negocio (dos tiendas distintas pueden tener al mismo cliente sin pisarse).

Lo que lo distingue de una ficha de contacto común es la **ventana de pago**:

```
Rosa  paga del  1 al 10        Pedro  paga del 20 al 30
```

Cada cliente tiene su propio ciclo. De ahí sale el vencimiento de cada factura
suya. Es el campo más importante del formulario.

**Al crear un cliente se le abre su primera factura automáticamente.** No hay
que hacer nada: el primer ticket que se cargue ya tiene dónde ir.

---

## Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/clientes` | Listado con búsqueda, filtros y paginación |
| `GET` | `/clientes/:id` | Detalle, con deuda y factura abierta |
| `POST` | `/clientes` | Alta |
| `PUT` | `/clientes/:id` | Edición parcial |

---

## GET /clientes

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
      "_id": "6a9d90350b11ce7547c32fdf",
      "nombre": "Ana López",
      "dni": "33333333",
      "telefono": "1155667788",
      "email": "ana@mail.com",
      "direccion": "Calle 123",
      "limiteCredito": 50000,
      "ventanaPago": { "desdeDia": 1, "hastaDia": 10 },
      "deuda": 18000,
      "facturasVencidas": 0,
      "createdAt": "2026-09-06T16:09:25.330Z",
      "updatedAt": "2026-09-06T16:09:25.330Z"
    }
  ],
  "total": 5,
  "pagina": 1,
  "porPagina": 20,
  "paginas": 1
}
```

`deuda` es la suma de **todas** sus facturas con saldo, no solo la del mes.
`facturasVencidas` es cuántas se le pasaron de fecha. Los dos se calculan en la
consulta, no están guardados.

## GET /clientes/:id

```jsonc
{
  "_id": "6a9d90350b11ce7547c32fdf",
  "nombre": "Ana López",
  "dni": "33333333",
  "telefono": "1155667788",
  "limiteCredito": 50000,
  "ventanaPago": { "desdeDia": 1, "hastaDia": 10 },
  "deuda": 18000,
  "facturaAbierta": {
    "_id": "...",
    "estado": "abierta",
    "estadoVisible": "abierta",
    "venceEl": "2026-09-11T02:59:59.999Z",
    "saldo": 18000,
    "cantidadTickets": 1,
    "vencida": false,
    "diasParaVencer": 5
  }
}
```

**Mostrá `estadoVisible`, no `estado`.** "vencida" se calcula por fecha y no
existe como valor de `estado`:

| `estadoVisible` | Significa |
| --- | --- |
| `abierta` | Período en curso, todavía no vence |
| `vencida` | Se pasó la fecha y sigue debiendo |
| `cerrada` | Período terminado, esperando el pago |
| `sin deuda` | Tuvo movimiento y está en cero |
| `pagada` | Saldada |

| Error | Status |
| --- | --- |
| No existe, o es de otro negocio | `404` `{ error: "Cliente no encontrado" }` |
| Id mal formado (`/clientes/pepe`) | `400` `{ error: 'El valor de "_id" no es válido' }` |

## POST /clientes

```jsonc
{
  "nombre": "Ana López",          // requerido
  "dni": "33333333",              // requerido, único en el negocio
  "telefono": "1155667788",       // opcional
  "email": "ana@mail.com",        // opcional
  "direccion": "Calle 123",       // opcional
  "limiteCredito": 50000,         // opcional, default 0 = sin límite
  "ventanaPago": {                // opcional, default { 1, 10 }
    "desdeDia": 1,
    "hastaDia": 10
  }
}
```

Responde `201` con el cliente **más su `facturaAbierta`** recién creada.

| Error | Status | Respuesta |
| --- | --- | --- |
| Falta nombre o DNI | `400` | `{ error: "Datos inválidos", detalles: { nombre: "Path \`nombre\` is required." } }` |
| DNI repetido | `409` | `{ error: "Ya existe un registro con ese dni" }` |
| `desdeDia` > `hastaDia` | `400` | `{ error: "El día de inicio de la ventana no puede ser posterior al de fin" }` |
| Día fuera de 1–31 | `400` | `{ error: "Los días de la ventana de pago tienen que estar entre 1 y 31" }` |

## PUT /clientes/:id

**Parcial**: mandá solo lo que cambió. Lo que no mandes queda como está.

```jsonc
{ "limiteCredito": 80000 }
```

Mismas validaciones y errores que el alta. Responde `200` con el cliente.

> Cambiar la ventana de pago afecta a las facturas que se abran **de ahí en
> más**. La que está abierta hoy mantiene su vencimiento.

---

## El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](README-FRONTEND.md), que ya
resuelve el token y convierte los errores en `ApiError`.

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

/** Como viene en el listado: con sus totales ya calculados. */
export interface ClienteEnLista extends Cliente {
  deuda: number;
  facturasVencidas: number;
}

export interface FacturaAbierta {
  _id: string;
  estado: "abierta" | "cerrada" | "pagada" | "anulada";
  /** Lo que se muestra: incluye "vencida", que no está en `estado`. */
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

/** Solo manda lo que tiene valor: si no, la URL se llena de params vacíos. */
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

/** Lo que manda el formulario, al crear y al editar. */
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

  /** El backend le abre la primera factura solo. */
  crear(datos: DatosCliente) {
    return request<ClienteDetalle>("/clientes", { method: "POST", body: datos });
  },

  /** Parcial: los campos ausentes quedan como están, no se borran. */
  editar(id: string, cambios: Partial<DatosCliente>) {
    return request<Cliente>(`/clientes/${id}`, { method: "PUT", body: cambios });
  },
};
```

### Listado con buscador

```ts
const [filtros, setFiltros] = useState<FiltrosClientes>({ pagina: 1 });
const [pagina, setPagina] = useState<Pagina<ClienteEnLista> | null>(null);

useEffect(() => {
  // Debounce: sin esto se dispara una request por tecla.
  const t = setTimeout(() => {
    clientesService.listar(filtros).then(setPagina).catch(manejarError);
  }, 300);
  return () => clearTimeout(t);
}, [filtros]);
```

### Alta, mostrando los errores donde corresponde

```ts
try {
  const cliente = await clientesService.crear({
    nombre, dni, telefono,
    limiteCredito: 50000,
    ventanaPago: { desdeDia: 1, hastaDia: 10 },
  });
  router.push(`/clientes/${cliente._id}`);
} catch (e) {
  if (!(e instanceof ApiError)) throw e;

  // 400 → detalles = { nombre: "Path `nombre` is required." }
  setErroresPorCampo(e.detalles ?? {});

  // 409 → el DNI ya existe: va bajo ESE campo, no como error general
  if (e.status === 409) setErroresPorCampo({ dni: e.message });
  else setError(e.message);
}
```

---

## Checklist de la pantalla

### Listado
- [ ] Nombre, DNI, teléfono y deuda por fila
- [ ] Buscador con debounce de ~300 ms
- [ ] Chips de filtro: "Solo deudores", "Solo vencidos"
- [ ] Scroll infinito o paginador con `pagina` / `paginas`
- [ ] Destacar `deuda > 0`
- [ ] En rojo los de `facturasVencidas > 0`
- [ ] Alertar si `limiteCredito > 0 && deuda > limiteCredito`
- [ ] Estado vacío distinto para "no hay clientes" y "la búsqueda no encontró nada"
- [ ] Botón de alta

### Alta y edición
- [ ] Nombre y DNI obligatorios, validados antes de enviar
- [ ] Selector de ventana de pago con 1–10 por defecto
- [ ] Impedir `desdeDia > hastaDia` desde el propio control
- [ ] Errores de `detalles` bajo cada campo
- [ ] El 409 va bajo el campo DNI
- [ ] En edición, precargar y mandar solo lo que cambió
- [ ] Avisar que cambiar la ventana no mueve el vencimiento de la factura actual

### Detalle
- [ ] Deuda total arriba de todo
- [ ] Tarjeta de la factura abierta con saldo, `venceEl` y `diasParaVencer`
- [ ] Usar `estadoVisible` para el chip de estado
- [ ] Accesos a: editar, cargar ticket, registrar pago
