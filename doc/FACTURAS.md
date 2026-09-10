# Vista de facturación

Cómo listar las facturas del negocio y abrir el detalle de una, con sus tickets
y los datos del cliente. **Solo lectura** — cerrar una factura, marcarla pagada
y registrar pagos van en otra guía.

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

## Qué es una factura acá

**La cuenta de un cliente para un período.** No es un comprobante fiscal: nace
abierta y los tickets se le van pegando solos. Es el modelo del resumen de
tarjeta — siempre hay un período abierto.

```
        se crea el cliente
                ↓
        factura #— ABIERTA ────────────────────────┐
                ↓                                  │
        ticket · ticket · ticket                   │ se le pegan solos
                ↓                                  │
        llega el vencimiento ──────────────────────┘
                ↓
        factura #12 CERRADA  (recién acá recibe número)
                ↓  se paga
        factura #12 PAGADA
```

**El cliente tiene siempre exactamente una factura abierta**, garantizado por un
índice único en la base. El administrador nunca elige a cuál va un ticket.

### Los estados

`estado` guarda cuatro valores, pero **la pantalla tiene que mostrar
`estadoVisible`**, que agrega dos casos que no se guardan:

| `estadoVisible` | Significa |
| --- | --- |
| `abierta` | Período en curso, todavía no vence |
| `vencida` | Se pasó la fecha y sigue debiendo |
| `cerrada` | Período terminado, esperando el pago |
| `sin deuda` | Tuvo movimiento y quedó en cero |
| `pagada` | Saldada |
| `anulada` | — |

**"vencida" no es un estado guardado, se calcula con `venceEl`.** Si lo fuera,
alguien tendría que ir a marcarlo, y las facturas de clientes que dejaron de
comprar quedarían para siempre como al día.

### El número

`numero` es el correlativo del negocio y **se asigna al cerrar, no al abrir**.
Una factura abierta no tiene número todavía: si lo tuviera, un cliente que se
dio de alta y nunca compró se llevaría uno.

En la pantalla eso significa: `N° 0012` cuando está cerrada o pagada, y algo
como "Período en curso" cuando está abierta.

> **La clave `numero` no viene en el JSON mientras la factura está abierta** —
> no llega como `null`, directamente está ausente. En el front va como
> `numero?: number` y se chequea con `if (factura.numero)`.

---

## Los 3 endpoints de lectura

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/facturas` | El listado, paginado y con filtros |
| `GET` | `/facturas/:id` | El detalle: factura + tickets + pagos + cliente |
| `GET` | `/facturas/vencidas` | Las que pasaron su fecha y siguen con saldo |

Y dos atajos por cliente, que ya existían:

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/clientes/:id/factura-actual` | La cuenta abierta. **Misma forma que `/facturas/:id`** |
| `GET` | `/clientes/:id/facturas` | El historial del cliente, sin tickets |

---

## GET /facturas

| Query param | Default | Qué hace |
| --- | --- | --- |
| `estado` | — | `abierta` · `cerrada` · `pagada` · `anulada` |
| `cliente` | — | `_id`, para ver las de uno solo |
| `vencidas` | `false` | `true` = pasaron su fecha y siguen con saldo |
| `buscar` | — | Texto en el **nombre o el DNI del cliente** |
| `pagina` | `1` | |
| `porPagina` | `20` | Máximo 100 |

```jsonc
{
  "datos": [
    {
      "_id": "6a9ee25e4db41c583b68cef4",
      // "numero" NO viene mientras está abierta: la clave está ausente
      "cliente": {                        // ← viene resuelto, no es un id
        "_id": "6a9ee25e4db41c583b68cef2",
        "nombre": "Ricardo Ramírez",
        "dni": "36165182",
        "telefono": "1132716458",
        "limiteCredito": 500000
      },
      "estado": "abierta",
      "estadoVisible": "abierta",
      "vencida": false,
      "desde": "2026-09-07T16:12:14.569Z",
      "venceEl": "2026-09-11T02:59:59.999Z",
      "diasParaVencer": 3,
      "cantidadTickets": 1,
      "totalMercaderia": 59000,
      "totalPagadoEnTickets": 9000,
      "totalFiado": 50000,
      "totalPagos": 0,
      "saldo": 50000
    }
  ],
  "total": 1,
  "pagina": 1,
  "porPagina": 20,
  "paginas": 1
}
```

Ordenado por fecha de creación, de la más nueva a la más vieja.

**El cliente viene resuelto en cada fila** (nombre, DNI, teléfono y límite): la
lista se arma sin una segunda consulta, y el teléfono está ahí para el botón de
WhatsApp cuando llegue la cobranza.

| Error | Status | Respuesta |
| --- | --- | --- |
| `estado` que no existe | `400` | `{ error: "Estado inválido. Los válidos son: abierta, cerrada, pagada, anulada", detalles: { estado, validos } }` |

> **Ojo con `?vencidas=true` combinado con `?estado=`.** Vencida no es un estado:
> el filtro busca fecha pasada con saldo entre las abiertas y cerradas. Si además
> mandás `estado=pagada` no va a devolver nada, porque una pagada no tiene saldo.

## GET /facturas/:id

```jsonc
{
  "cliente": { "_id": "...", "nombre": "Ricardo Ramírez", "dni": "36165182",
               "telefono": "1132716458", "email": "...", "direccion": "...",
               "limiteCredito": 500000, "ventanaPago": { "desdeDia": 1, "hastaDia": 10 } },
  "factura": { /* igual que en el listado, con estadoVisible y diasParaVencer */ },
  "tickets": [
    {
      "_id": "6aa0185ab32e1f350d473169",
      "fecha": "2026-09-08T14:14:50.285Z",
      "items": [
        { "nombre": "Pantalón largo", "talle": "34", "especieNombre": "Pantalón",
          "cantidad": 1, "precioUnitario": 50000, "subtotal": 50000 },
        { "nombre": "Media deportiva", "talle": "M", "especieNombre": "Media",
          "cantidad": 3, "precioUnitario": 3000, "subtotal": 9000 }
      ],
      "total": 59000,
      "pagado": 9000,
      "faltante": 50000
    }
  ],
  "pagos": []
}
```

Los tickets vienen **ordenados por fecha ascendente**: se leen como la libreta,
de arriba para abajo.

**Vienen también los anulados**, con `anulado: true`. No suman a los totales de
la factura, pero siguen en la lista para que se vean tachados — ver
[CREATE_TICK.md](CREATE_TICK.md#delete-ticketsid--anular).

Cada ítem trae `especieNombre` copiado, así que la tabla se arma sin ir a buscar
la especie. Y `faltante` ya viene calculado por ticket.

| Error | Status | Respuesta |
| --- | --- | --- |
| No existe, o es de otro negocio | `404` | `{ error: "Factura no encontrada" }` |
| Id mal formado | `400` | `{ error: 'El valor de "_id" no es válido' }` |

> **`GET /clientes/:id/factura-actual` devuelve exactamente esta misma forma.**
> Es a propósito: la pantalla de la factura es una sola, se llegue desde el
> listado de facturación o desde la ficha del cliente. La única diferencia es que
> `factura-actual` siempre te da la abierta, y si estaba vencida la renueva antes
> de responder.

## GET /facturas/vencidas

Sin params. Devuelve un **array plano** (no paginado) con el cliente resuelto,
ordenado por vencimiento: **la más atrasada primero**. Es la cola de cobranza.

```jsonc
[
  { "_id": "...", "numero": 12, "cliente": { "nombre": "Ana López", "dni": "3333",
    "telefono": "115566" }, "estadoVisible": "vencida", "saldo": 18000,
    "venceEl": "2026-08-10T02:59:59.999Z", "diasParaVencer": -29 }
]
```

`diasParaVencer` en negativo son los días de atraso: `-29` = hace 29 días.

---

## El servicio

```ts
// src/api/facturas.service.ts
import { request } from "./client";
import type { Ticket } from "./tickets.service";   // ver CREATE_TICK.md

export type EstadoFactura = "abierta" | "cerrada" | "pagada" | "anulada";

/** El cliente como viene dentro de una fila del listado. */
export interface ClienteEnFactura {
  _id: string;
  nombre: string;
  dni: string;
  telefono?: string;
  limiteCredito: number;
}

export interface Factura {
  _id: string;
  /**
   * Ausente mientras está abierta: el número se asigna al cerrar.
   * Es `undefined`, no `null` — la clave directamente no viene en el JSON.
   */
  numero?: number;
  cliente: ClienteEnFactura;
  estado: EstadoFactura;
  /** Lo que se muestra: agrega "vencida" y "sin deuda". */
  estadoVisible: string;
  vencida: boolean;
  desde: string;
  venceEl: string;
  /** Negativo = días de atraso. */
  diasParaVencer: number;
  cantidadTickets: number;
  totalMercaderia: number;
  totalPagadoEnTickets: number;
  totalFiado: number;
  totalPagos: number;
  saldo: number;
}

export interface Pago {
  _id: string;
  fecha: string;
  monto: number;
  metodoPago?: string;
  nota?: string;
}

/** El detalle. Misma forma que GET /clientes/:id/factura-actual. */
export interface FacturaDetalle {
  cliente: ClienteEnFactura & {
    email?: string;
    direccion?: string;
    ventanaPago: { desdeDia: number; hastaDia: number };
  };
  factura: Factura;
  tickets: Ticket[];
  pagos: Pago[];
}

export interface Pagina<T> {
  datos: T[];
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
}

export interface FiltrosFacturas {
  estado?: EstadoFactura;
  cliente?: string;
  vencidas?: boolean;
  buscar?: string;
  pagina?: number;
  porPagina?: number;
}

/** Solo manda lo que tiene valor: si no, la URL se llena de params vacíos. */
function armarQuery(f: FiltrosFacturas): string {
  const params = new URLSearchParams();
  if (f.estado) params.set("estado", f.estado);
  if (f.cliente) params.set("cliente", f.cliente);
  if (f.vencidas) params.set("vencidas", "true");
  if (f.buscar?.trim()) params.set("buscar", f.buscar.trim());
  if (f.pagina && f.pagina > 1) params.set("pagina", String(f.pagina));
  if (f.porPagina) params.set("porPagina", String(f.porPagina));
  const q = params.toString();
  return q ? `?${q}` : "";
}

export const facturasService = {
  listar(filtros: FiltrosFacturas = {}) {
    return request<Pagina<Factura>>(`/facturas${armarQuery(filtros)}`);
  },

  detalle(id: string) {
    return request<FacturaDetalle>(`/facturas/${id}`);
  },

  /** Array plano, ya ordenado por atraso. La cola de cobranza. */
  vencidas() {
    return request<Factura[]>("/facturas/vencidas");
  },

  /** La cuenta abierta de un cliente. Misma forma que `detalle`. */
  actualDe(clienteId: string) {
    return request<FacturaDetalle>(`/clientes/${clienteId}/factura-actual`);
  },

  /** Historial del cliente. Sin tickets: para la lista de períodos. */
  historialDe(clienteId: string) {
    return request<Factura[]>(`/clientes/${clienteId}/facturas`);
  },
};
```

### El chip de estado

Lo único con algo de lógica. Sale de `estadoVisible`, nunca de `estado`:

```ts
export function colorEstado(f: Factura): "verde" | "rojo" | "amarillo" | "gris" {
  switch (f.estadoVisible) {
    case "pagada":
    case "sin deuda":  return "verde";
    case "vencida":    return "rojo";
    case "cerrada":    return "amarillo";   // esperando el pago
    default:           return "gris";       // abierta, en curso
  }
}

export function textoVencimiento(f: Factura): string {
  if (f.diasParaVencer < 0) return `${Math.abs(f.diasParaVencer)} días de atraso`;
  if (f.diasParaVencer === 0) return "vence hoy";
  return `vence en ${f.diasParaVencer} días`;
}
```

---

## La pantalla

### Listado

```
┌──────────────────────────────────────────────────────────┐
│  Facturación            [buscar cliente...          ]    │
│  ( todas ) ( abiertas ) ( vencidas ) ( pagadas )         │
├──────────────────────────────────────────────────────────┤
│  Ricardo Ramírez    36165182    ● abierta                │
│  1 ticket · vence en 3 días              $50.000    ›    │
├──────────────────────────────────────────────────────────┤
│  Ana López          33333333    ● vencida                │
│  N° 0012 · 29 días de atraso             $18.000    ›    │
└──────────────────────────────────────────────────────────┘
```

### Detalle

```
┌──────────────────────────────────────────────────────────┐
│  ‹  Ricardo Ramírez · 36165182            ● abierta      │
│     Período en curso · vence el 11/09                    │
├──────────────────────────────────────────────────────────┤
│  08/09    Pantalón largo   34  Pantalón  x1     $50.000  │
│           Media deportiva  M   Media     x3     $ 9.000  │
│           ───────────────────────────────────────────    │
│           total $59.000 · dejó $9.000 · debe $50.000     │
├──────────────────────────────────────────────────────────┤
│  Mercadería                                     $59.000  │
│  Dejó en el momento                           − $ 9.000  │
│  Pagos a cuenta                               − $     0  │
│  ══════════════════════════════════════════════════════  │
│  SALDO                                          $50.000  │
├──────────────────────────────────────────────────────────┤
│         [ Cargar ticket ]   [ Registrar pago ]           │
└──────────────────────────────────────────────────────────┘
```

Los cinco totales se leen en ese orden y cierran solos. `saldo` es
`totalFiado − totalPagos`, y es **el número grande de la pantalla**.

### Checklist

**Listado**
- [ ] Nombre y DNI del cliente por fila (vienen resueltos, no hay que buscarlos)
- [ ] Chip con `estadoVisible`, nunca con `estado`
- [ ] Saldo a la derecha, destacado
- [ ] `N° 0012` si tiene número; "Período en curso" si está abierta
- [ ] Texto de vencimiento con `diasParaVencer` (negativo = atraso)
- [ ] Chips de filtro: todas / abiertas / vencidas / pagadas
- [ ] Buscador por cliente con debounce (~300 ms)
- [ ] Paginación con `pagina` / `paginas`
- [ ] Las vencidas primero visualmente, o un acceso a `/facturas/vencidas`

**Detalle**
- [ ] Cabecera con el cliente y el chip de estado
- [ ] Un bloque por ticket, con sus ítems y su faltante
- [ ] Los anulados (`anulado: true`) tachados y en gris, con su motivo
- [ ] Ítems: nombre, talle, `especieNombre`, cantidad, subtotal
- [ ] Los pagos a cuenta en su propia sección, con fecha y método
- [ ] Los cinco totales en orden, con el saldo destacado
- [ ] Botones a cargar ticket y registrar pago
- [ ] Estado vacío: "todavía no se llevó nada este período"

**Errores**
- [ ] 404 → "Esa factura no existe" y volver al listado
- [ ] El 400 de `estado` inválido no debería pasar nunca: los chips mandan
      valores fijos. Si pasa, es un bug del front

---

## Lo que falta

Esta guía cubre solo la lectura. Ya existen en el backend, sin documentar:

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/clientes/:id/pagos` | Entrega a cuenta. Se imputa a la factura más vieja con saldo |
| `POST` | `/facturas/:id/cerrar` | Cerrarla antes de que venza |
| `PUT` | `/facturas/:id/pagada` | Marcarla saldada (exige saldo en 0) |

Los tres son la etapa de **cobranza**, y van en su propia guía. El CRUD del
ticket (crear, editar, anular) está en [CREATE_TICK.md](CREATE_TICK.md).
