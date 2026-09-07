# Guía de integración con el frontend

Cómo consumir esta API desde el front. Está pensada para las tres vistas que ya
existen — **login**, **registro** y **recuperar contraseña** — más el manejo de
sesión que las tres comparten.

El código de ejemplo es TypeScript con `fetch`, sin dependencias ni framework:
funciona igual en React, Vue o Svelte. Lo único que cambia según el framework es
dónde guardás el estado del usuario.

---

## 1. Configuración

El backend corre en `http://localhost:4000` y tiene **CORS abierto a todos los
orígenes**, así que desde `localhost:5173` no hay que configurar nada.

La autenticación va por header `Authorization`, no por cookies, así que tampoco
hace falta `credentials: "include"`.

```bash
# .env del frontend (Vite)
VITE_API_URL=http://localhost:4000
```

> **Importante:** en el `.env` del **backend** tiene que estar `FRONTEND_URL`
> apuntando a tu front, porque de ahí se arma el link del mail de recuperación:
> `<FRONTEND_URL>/resetear-password?token=xxx`. Por defecto está en
> `http://localhost:5173`.

---

## 2. Forma de las respuestas

**Cuando sale bien**, los endpoints de sesión devuelven siempre lo mismo:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "usuario": {
    "_id": "6a99e6bb9b65a5ec2c2b4730",
    "nombre": "Ana Gomez",
    "email": "ana@tienda.com",
    "rol": "administrador",
    "createdAt": "2026-09-03T21:29:31.331Z",
    "updatedAt": "2026-09-03T21:29:31.331Z"
  }
}
```

El hash de la contraseña nunca viaja: el `usuario` ya viene limpio.

**Cuando sale mal**, siempre esta forma:

```json
{ "error": "Datos inválidos", "detalles": { "nombre": "Path `nombre` is required." } }
```

| Campo | Cuándo aparece |
| --- | --- |
| `error` | Siempre. Es el mensaje listo para mostrarle al usuario. |
| `detalles` | Solo en errores de validación por campo. Es `{ campo: motivo }`. |
| `stack` | Solo en errores 500 y fuera de producción. Ignoralo en el front. |

### Códigos que vas a recibir

| Status | Qué significa | Qué hacer en el front |
| --- | --- | --- |
| 400 | Datos inválidos | Mostrar `error`, y `detalles` bajo cada campo |
| 401 | Credenciales mal, o sesión caída | En login: mostrar el error. En el resto: cerrar sesión |
| 403 | Logueado pero sin permiso | Mostrar el error, no desloguear |
| 404 | No existe | Mostrar el error |
| 409 | Ya existe (email repetido) | Mostrar el error en el campo email |
| 429 | Demasiados intentos | Mostrar el error; viene con header `Retry-After` en segundos |
| 500 | Bug del servidor | Mensaje genérico; el detalle está en la consola del backend |
| 0 | No es del backend: no se pudo conectar | "No se pudo conectar con el servidor". Lo genera el cliente de abajo, no la API |

---

## 3. El cliente HTTP

Un solo lugar que arma la request, mete el token y convierte los errores en algo
que el front pueda mostrar.

```ts
// src/api/client.ts
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const CLAVE_TOKEN = "token";

export const getToken = () => localStorage.getItem(CLAVE_TOKEN);
export const setToken = (token: string) => localStorage.setItem(CLAVE_TOKEN, token);
export const clearToken = () => localStorage.removeItem(CLAVE_TOKEN);

/** Error de la API, ya con el mensaje listo para mostrar. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    mensaje: string,
    /** Errores por campo, cuando el backend los manda: { nombre: "es requerido" } */
    readonly detalles?: Record<string, string>,
    /** Segundos a esperar, solo en un 429. */
    readonly reintentarEn?: number,
    /** Si la request salió con token. Ver esSesionCaida. */
    private readonly mandoToken = false
  ) {
    super(mensaje);
    this.name = "ApiError";
  }

  /**
   * Un 401 significa dos cosas distintas según el caso:
   *   - login/registro (sin token) → las credenciales están mal
   *   - cualquier otra ruta (con token) → la sesión venció o se revocó
   * Solo el segundo caso justifica desloguear, por eso miramos si se
   * llegó a mandar un token.
   */
  get esSesionCaida() {
    return this.status === 401 && this.mandoToken;
  }
}

interface Opciones {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Por defecto manda el token si lo hay. Poné false en login/registro. */
  conToken?: boolean;
}

export async function request<T>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { method = "GET", body, conToken = true } = opciones;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const token = conToken ? getToken() : null;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const mandoToken = Boolean(token);

  let respuesta: Response;
  try {
    respuesta = await fetch(`${API_URL}${ruta}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // El fetch ni llegó: backend apagado, sin internet, CORS.
    throw new ApiError(0, "No se pudo conectar con el servidor");
  }

  // 204 y similares no traen cuerpo.
  const texto = await respuesta.text();
  const datos = texto ? JSON.parse(texto) : {};

  if (!respuesta.ok) {
    const reintentar = respuesta.headers.get("Retry-After");
    throw new ApiError(
      respuesta.status,
      datos.error ?? "Ocurrió un error inesperado",
      datos.detalles,
      reintentar ? Number(reintentar) : undefined,
      mandoToken
    );
  }

  return datos as T;
}
```

---

## 4. El servicio de autenticación

```ts
// src/api/auth.service.ts
import { request, setToken, clearToken } from "./client";

export interface Usuario {
  _id: string;
  nombre: string;
  email: string;
  rol: "administrador" | "super_admin";
  createdAt: string;
  updatedAt: string;
}

export interface Sesion {
  token: string;
  usuario: Usuario;
}

/** Guarda el token y devuelve el usuario. Lo usan registro, login y reseteo. */
function abrirSesion(sesion: Sesion): Usuario {
  setToken(sesion.token);
  return sesion.usuario;
}

export const authService = {
  /** Vista de registro. Crea la cuenta y ya deja al usuario logueado. */
  async registro(datos: { nombre: string; email: string; password: string }) {
    const sesion = await request<Sesion>("/auth/registro", {
      method: "POST",
      body: datos,
      conToken: false,
    });
    return abrirSesion(sesion);
  },

  /** Vista de login. */
  async login(datos: { email: string; password: string }) {
    const sesion = await request<Sesion>("/auth/login", {
      method: "POST",
      body: datos,
      conToken: false,
    });
    return abrirSesion(sesion);
  },

  /** Rehidrata la sesión al recargar la página. */
  async me() {
    const { usuario } = await request<{ usuario: Usuario }>("/auth/me");
    return usuario;
  },

  logout() {
    clearToken();
  },

  // --- Recuperación de contraseña, los 3 pasos ---

  /** Paso 1: pide el mail con el link. */
  async pedirRecuperacion(email: string) {
    return request<{ mensaje: string }>("/auth/recuperar-password", {
      method: "POST",
      body: { email },
      conToken: false,
    });
  },

  /** Paso 2: valida el token antes de mostrar el formulario. */
  async validarTokenReset(token: string) {
    return request<{ valido: true; email: string }>(
      `/auth/recuperar-password/${token}`,
      { conToken: false }
    );
  },

  /** Paso 3: guarda la contraseña nueva. Devuelve la sesión ya iniciada. */
  async resetearPassword(datos: { token: string; password: string }) {
    const sesion = await request<Sesion>("/auth/resetear-password", {
      method: "POST",
      body: datos,
      conToken: false,
    });
    return abrirSesion(sesion);
  },

  /** Cambio de contraseña con la sesión abierta (vista de perfil). */
  async cambiarPassword(datos: { passwordActual: string; passwordNueva: string }) {
    const sesion = await request<Sesion>("/auth/cambiar-password", {
      method: "POST",
      body: datos,
    });
    return abrirSesion(sesion);
  },
};
```

---

## 5. Las tres vistas

### Login

```ts
try {
  const usuario = await authService.login({ email, password });
  // token ya guardado → navegar al dashboard
} catch (e) {
  if (e instanceof ApiError) {
    // 401 → "Credenciales inválidas"
    // 429 → "Demasiados intentos. Probá de nuevo en 15 minutos."
    setError(e.message);
  }
}
```

El backend devuelve **el mismo mensaje** si el email no existe o si la contraseña
está mal, a propósito: si no, se puede averiguar qué emails están registrados
probando de a uno. No intentes distinguir los dos casos en el front.

Límite: **10 intentos cada 15 minutos** por IP. Un login exitoso resetea el
contador.

### Registro

```ts
try {
  const usuario = await authService.registro({ nombre, email, password });
  // 201: la cuenta queda creada Y logueada, no mandes al login
} catch (e) {
  if (e instanceof ApiError) {
    // e.detalles trae los errores por campo, si los hay
    setErroresPorCampo(e.detalles ?? {});
    setError(e.message);
  }
}
```

Validaciones que aplica el backend (conviene replicarlas en el form para no
depender del ida y vuelta):

| Campo | Regla |
| --- | --- |
| `nombre` | Requerido, no vacío |
| `email` | Requerido, formato válido, no repetido |
| `password` | Requerido, **mínimo 6 caracteres** |

El rol se asigna solo: toda cuenta nueva queda como `administrador`, con sus
clientes y productos aislados del resto. Mandar `rol` en el body no hace nada.

Límite: 10 registros por hora por IP.

### Recuperar contraseña

Son **dos pantallas**, porque el usuario sale de la app y vuelve por el mail.

**Pantalla A — "olvidé mi contraseña"**

```ts
await authService.pedirRecuperacion(email);
// Mostrar SIEMPRE el mismo mensaje de éxito, exista o no el email.
setMensaje("Si el email está registrado, te va a llegar un link.");
```

El backend responde 200 aunque el email no exista, por la misma razón que en el
login. No muestres "ese email no está registrado".

Límite: **5 pedidos cada 15 minutos** por IP.

**Pantalla B — `/resetear-password?token=xxx`**

Tu front necesita una ruta en `/resetear-password` que lea el token del query
string. Es la URL que se manda por mail.

```ts
const token = new URLSearchParams(location.search).get("token");

// 1) Al montar: validar antes de mostrar el formulario
try {
  const { email } = await authService.validarTokenReset(token!);
  setEmail(email);          // podés mostrar "Nueva contraseña para ana@tienda.com"
  setTokenValido(true);
} catch {
  setTokenValido(false);    // → "El link no es válido o ya venció"
}

// 2) Al enviar el formulario
const usuario = await authService.resetearPassword({ token: token!, password });
// Devuelve la sesión iniciada → mandalo directo al dashboard, no al login
```

El token **vive 60 minutos y es de un solo uso**. Si el usuario recarga la
pantalla después de resetear, el paso 1 va a fallar — es lo esperado.

---

## 6. Sesión

### Al arrancar la app

```ts
const token = getToken();
if (!token) {
  // no logueado
} else {
  try {
    const usuario = await authService.me();   // token todavía válido
  } catch {
    clearToken();                             // vencido o revocado
  }
}
```

### Cuándo se cae la sesión

El token dura **7 días**, pero además **se invalida antes de tiempo** si el
usuario cambió su contraseña (por reseteo o desde el perfil). En ese caso todas
las sesiones abiertas en otros dispositivos empiezan a recibir:

```json
{ "error": "Tu contraseña cambió, iniciá sesión de nuevo" }
```

> **Detalle fino:** un token emitido en el **mismo segundo** que el cambio de
> contraseña no se invalida. Es a propósito: el `iat` de un JWT tiene resolución
> de un segundo, y sin ese margen el token que devuelve el propio reseteo se
> invalidaría a sí mismo. En la práctica no lo vas a notar, pero explica por qué
> la pestaña donde hiciste el cambio sigue andando.

Conviene manejar el 401 en un solo lugar:

```ts
// Envolvé las llamadas de tu app con esto
export async function conSesion<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError && e.esSesionCaida) {
      clearToken();
      window.location.href = "/login";
    }
    throw e;
  }
}
```

Se puede usar en cualquier lado sin miedo: `esSesionCaida` solo da `true` si la
request salió **con** un token, así que el 401 de "credenciales inválidas" del
login (que va sin token) no dispara el logout.

---

## 7. Referencia de endpoints

🔒 = requiere header `Authorization: Bearer <token>`

### Autenticación

| Método | Ruta | Body | Respuesta |
| --- | --- | --- | --- |
| POST | `/auth/registro` | `{ nombre, email, password }` | 201 `{ token, usuario }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, usuario }` |
| GET | `/auth/me` 🔒 | — | `{ usuario }` |
| POST | `/auth/recuperar-password` | `{ email }` | `{ mensaje }` |
| GET | `/auth/recuperar-password/:token` | — | `{ valido, email }` |
| POST | `/auth/resetear-password` | `{ token, password }` | `{ token, usuario }` |
| POST | `/auth/cambiar-password` 🔒 | `{ passwordActual, passwordNueva }` | `{ token, usuario }` |

### Resto de la API (todo 🔒)

| Método | Ruta | Notas |
| --- | --- | --- |
| GET | `/clientes` | Devuelve cada cliente con su `cuentaCorriente` embebida |
| GET | `/clientes/:id` | Ídem, uno solo |
| POST | `/clientes` | `{ nombre, telefono, email, direccion, limiteCredito }` — crea también la cuenta corriente |
| PUT | `/clientes/:id` | Datos del cliente, no toca el saldo |
| PUT | `/clientes/:id/limite-credito` | `{ limiteCredito }` |
| DELETE | `/clientes/:id` | Borra cliente + cuenta corriente |
| GET | `/clientes/:id/cuenta-corriente` | `{ cliente, cuentaCorriente, movimientos }` |
| POST | `/clientes/:id/movimientos` | Ticket o pago, ver abajo |
| DELETE | `/movimientos/:id` | Anula y recalcula el saldo (devuelve el stock) |
| GET | `/clientes/:id/facturas/preview` | Vista previa del período sin emitir nada. Acepta `?desde=&hasta=` |
| POST | `/clientes/:id/facturas` | Emite la factura del período. Body `{ desde?, hasta? }`, sin fechas usa el mes actual |
| GET | `/clientes/:id/facturas` | Historial de facturas del cliente |
| GET | `/facturas` | Todas las del negocio. Acepta `?estado=emitida\|pagada\|anulada` |
| GET | `/facturas/:id` | Detalle: `{ factura, tickets, pagos }` con los productos de cada ticket |
| PUT | `/facturas/:id/pagada` | Marcarla saldada |
| DELETE | `/facturas/:id` | Anula y libera los tickets |
| GET | `/productos` | |
| POST | `/productos` | `{ nombre, precio, stock }` |
| PUT | `/productos/:id` | |
| DELETE | `/productos/:id` | |
| GET/POST/DELETE | `/usuarios` | Solo `super_admin` |

**Movimientos** — el mismo endpoint hace las dos cosas según `tipo`:

Hay dos tipos de movimiento:

| `tipo` | Qué es | Efecto en el saldo |
| --- | --- | --- |
| `"ticket"` | El cliente se llevó mercadería fiada | Sube ⬆ |
| `"pago"` | El cliente entregó plata | Baja ⬇ |

```ts
// Ticket: se lleva $5000 en mercadería y deja $2000 en el momento.
// "pagado" es opcional; sin él, se fía todo.
await request("/clientes/ID/movimientos", {
  method: "POST",
  body: {
    tipo: "ticket",
    items: [{ producto: "ID_PRODUCTO", cantidad: 5 }],
    pagado: 2000,
  },
});
// → { movimiento, faltante: 3000, cuentaCorriente, warning }
//
//   El saldo sube SOLO el faltante ($3000), no el total de la mercadería:
//   lo que dejó en el momento ya está saldado.
//
//   warning != null si el cliente se pasó del límite de crédito.
//   Es un aviso para mostrar, NO bloquea la venta.

// Pago suelto: viene y entrega plata a cuenta, sin llevarse nada.
await request("/clientes/ID/movimientos", {
  method: "POST",
  body: { tipo: "pago", monto: 10000, metodoPago: "efectivo" },
});
// → { movimiento, cuentaCorriente }
```

Cada movimiento devuelto trae `faltante` calculado, así el front no tiene que
restar `total - pagado`.

**Facturas** — el resumen del período. Agrupa los tickets sin facturar entre dos
fechas, los lista con sus productos y suma **los faltantes**:

```ts
// Antes de emitir: ¿cuánto le doy este mes?
const preview = await request("/clientes/ID/facturas/preview");
// → { periodo, cantidadTickets, totalMercaderia,
//     totalPagadoEnTickets, totalTickets, totalPagos, totalAPagar,
//     tickets, pagos }

// Emitir
await request("/clientes/ID/facturas", { method: "POST", body: {} });
```

| Campo | Qué significa |
| --- | --- |
| `totalMercaderia` | Valor de todo lo que se llevó en el período |
| `totalPagadoEnTickets` | Lo que fue dejando en el momento de cada compra |
| `totalTickets` | Suma de los faltantes: lo que quedó anotado |
| `totalPagos` | Pagos sueltos del período |
| `totalAPagar` | **El número que importa**: lo que debe por este período |

Un ticket solo entra en una factura: al emitir queda marcado. Volver a facturar
el mismo período da 400 `"No hay tickets sin facturar en ese período"`. Anular
una factura (`DELETE`) libera sus tickets para volver a facturarlos.

Si no hay stock suficiente devuelve 400 con los datos para armar un mensaje útil:

```json
{
  "error": "Stock insuficiente de \"Remera\"",
  "detalles": { "producto": "Remera", "stockDisponible": 18, "cantidadPedida": 999 }
}
```

---

## 8. Probar sin configurar el mail

Mientras no haya SMTP en el `.env` del backend, **los mails se imprimen en la
consola del servidor** con el link incluido. Para probar el flujo de
recuperación: pedí el reseteo desde el front, mirá la consola del backend y
copiá el link al navegador.

```
📧 Email (no enviado, SMTP sin configurar)
   para:   ana@tienda.com
   asunto: Recuperá tu contraseña
   Hola Ana, para recuperar tu contraseña entrá acá (vence en 60 minutos):
   http://localhost:5173/resetear-password?token=10c723037f5db59e...
```
