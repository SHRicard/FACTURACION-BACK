# Backend de Cuenta Corriente

Backend con **TypeScript + Node.js + Express + MongoDB (Mongoose) + JWT**, para
gestionar clientes, sus cuentas corrientes y los tickets de venta / pagos.

## Instalación

```bash
npm install
```

## Estructura

```
src/
  server.ts          arranque y wiring de middlewares
  config/db.ts       conexión a MongoDB
  models/            schemas de mongoose, con sus interfaces
  routes/            endpoints
  middleware/        auth, rate limit, logger de requests, errorHandler
  utils/             logger, AppError, asyncHandler, email
  types/             tipos compartidos y augmentación de Express
dist/                salida de tsc (generada, no se versiona)
```

### Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Corre los `.ts` con tsx en modo watch, sin compilar |
| `npm run build` | Compila `src/` → `dist/` |
| `npm start` | Corre `dist/server.js` (necesita `build` antes) |
| `npm run typecheck` | Verifica tipos sin generar archivos |
| `npm run clean` | Borra `dist/` |

El `tsconfig.json` va con `strict` activado, más `noUncheckedIndexedAccess` y
`noImplicitOverride`. Los imports relativos llevan extensión `.js` aunque el
archivo sea `.ts`: es lo que exige `module: NodeNext`, porque es la ruta que Node
va a resolver en tiempo de ejecución.

## Configuración

1. Copiá `.env.example` como `.env`
2. Completá `MONGO_URI`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD`.

## Correr el servidor

```bash
./run.sh          # verifica todo y arranca (npm start)
./run.sh --dev    # igual, pero en modo watch
./run.sh --check  # solo verifica, no arranca
```

`run.sh` chequea antes de arrancar: versión de Node, dependencias instaladas,
que exista `.env` con todas las variables requeridas, que MongoDB responda
(muestra host, base y colecciones), que el puerto esté libre y que TypeScript
compile. Si algo falla, te dice exactamente qué. El log queda en `.run.log`.

En modo `--dev` no compila: corre los `.ts` con tsx, pero igual verifica los
tipos antes de arrancar.

También podés arrancarlo directo con `npm run dev`, o `npm run build && npm start`.

La primera vez que arranca, crea automáticamente el usuario `super_admin` con el
email/password que pusiste en `.env`.

## Logs y manejo de errores

Todos los errores se loguean en la consola y se responden en un formato único.
Las piezas están en `utils/` y `middleware/`:

| Archivo | Para qué sirve |
| --- | --- |
| `src/utils/logger.ts` | `logger.debug/info/warn/error/success`. Si le pasás un `Error` imprime el stack ya filtrado. |
| `src/utils/asyncHandler.ts` | Envuelve handlers async para que sus errores lleguen al middleware de errores. |
| `src/utils/AppError.ts` | `AppError` + atajos `noEncontrado`, `datosInvalidos`, `noAutorizado`, `prohibido`. |
| `src/middleware/requestLogger.ts` | Una línea por request: método, ruta, status, duración, usuario y motivo del error. |
| `src/middleware/errorHandler.ts` | Traduce el error a status + JSON y lo loguea. Va último en `server.ts`. |

### Cómo escribir una ruta

```ts
import { asyncHandler } from "../utils/asyncHandler.js";
import { noEncontrado } from "../utils/AppError.js";
import type { RequestAutenticado } from "../types/index.js";

// En rutas detrás de requireAuth se le pasa RequestAutenticado y ahí
// req.usuario deja de ser opcional.
router.get("/:id", requireAuth, asyncHandler<RequestAutenticado>(async (req, res) => {
  const producto = await Producto.findOne({
    _id: req.params["id"],
    administrador: req.usuario._id,   // ← tipado
  });
  if (!producto) throw noEncontrado("Producto");   // → 404
  res.json(producto);                              // ← acá ya no es null
}));
```

Sin `try/catch`: cualquier error que se escape lo agarra `errorHandler`, que lo
imprime en consola y responde el JSON. **Si olvidás el `asyncHandler`, un error
async deja la request colgada sin loguear nada** — es la única regla a respetar.

### Qué ves en la consola

```
17:40:30 DEBUG POST   /clientes/68b.../movimientos 201 15.8ms (admin@tuapp.com)
17:40:30 WARN  POST   /productos 400 8.9ms (admin@tuapp.com) — Datos inválidos {"nombre":"Path `nombre` is required."}
17:40:54 ERROR TypeError: Cannot read properties of undefined (reading 'nombre')
    at file:///.../src/routes/clientes.ts:31:30
17:40:54 ERROR   request: { params: {}, body: { email: 'a@b.com', password: '***' }, usuario: null }
```

Los errores 4xx ocupan una línea. Los 5xx (bugs) imprimen stack completo más los
`params`, `query`, `body` y usuario de la request. Las claves que matcheen
`password`, `token`, `secret`, `authorization` o `jwt` salen como `***`.

### Nivel de detalle

`LOG_LEVEL` acepta `debug | info | warn | error | silent`. Por defecto es `debug`
en desarrollo e `info` con `NODE_ENV=production` (ahí las requests exitosas dejan
de loguearse y solo quedan los errores).

### Códigos de respuesta

| Situación | Status | Body |
| --- | --- | --- |
| Validación de mongoose | 400 | `{ error: "Datos inválidos", detalles: { campo: "motivo" } }` |
| ObjectId mal formado | 400 | `{ error: 'El valor de "_id" no es válido' }` |
| Índice único repetido | 409 | `{ error: "Ya existe un registro con ese email" }` |
| Token ausente/inválido/vencido | 401 | `{ error: "Token inválido" }` |
| Ruta inexistente | 404 | `{ error: "Ruta no encontrada: GET /x" }` |
| Bug del servidor | 500 | `{ error: "Error interno del servidor", stack: [...] }` |

El `stack` solo se manda al cliente en los 500 y fuera de producción.

## Roles

Se declaran en un solo lugar: [`src/config/roles.ts`](src/config/roles.ts). El
enum del schema de mongoose, el rol por defecto y el middleware salen todos de
ahí.

En el MVP hay **dos**:

| Rol | Qué puede hacer |
| --- | --- |
| `super_admin` | Administra la plataforma. Único que entra a `/usuarios` para crear y borrar cuentas. Se crea solo al arrancar el servidor, desde `SUPER_ADMIN_EMAIL`. |
| `administrador` | Dueño de un negocio. Gestiona sus propios clientes, productos y movimientos. No ve los datos de otros administradores. |

**Todo usuario que se registra queda como `administrador`**, tanto por
`/auth/registro` como por `/auth/google`. El rol nunca se lee del body: si no,
cualquiera se daría de alta como `super_admin`. La única forma de asignar otro
rol es `POST /usuarios`, que solo puede llamar un `super_admin`.

El aislamiento entre administradores **no depende del rol sino del dato**: cada
query filtra por `administrador: req.usuario._id`. Por eso dos administradores
nunca se cruzan aunque tengan el mismo rol.

### Proteger una ruta por rol

```ts
import { requireAuth, requireRol } from "../middleware/auth.js";

router.use(requireAuth, requireRol("super_admin"));
// requireSuperAdmin es un atajo de esto mismo
```

### Agregar un rol nuevo

Está planificado sumar **`cliente`** más adelante (que el cliente final entre a
ver su propia cuenta corriente). Cuando llegue el momento:

1. Sumarlo a `ROLES` en `src/config/roles.ts`.
2. Describirlo en `DESCRIPCION_ROLES` — TypeScript lo va a exigir, no se puede olvidar.
3. Proteger las rutas con `requireRol("cliente")`.

No hay que tocar el modelo ni escribir un middleware nuevo.

## Flujo típico

### 1. Registro / Login

```bash
# Registro: crea la cuenta (rol "administrador") y ya devuelve la sesión
curl -X POST http://localhost:4000/auth/registro \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Ana Gomez","email":"ana@tienda.com","password":"secreta123"}'

# Login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@tienda.com","password":"secreta123"}'
```

Ambos devuelven `{ token, usuario }`. Usá el token en el header
`Authorization: Bearer <token>` en todas las demás requests.

### 2. Super admin crea un administrador

```bash
curl -X POST http://localhost:4000/usuarios \
  -H "Authorization: Bearer TOKEN_SUPER_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan","email":"juan@tienda.com","password":"1234"}'
```

### 3. El administrador (logueado) crea un producto

```bash
curl -X POST http://localhost:4000/productos \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Remera","precio":8000,"stock":20}'
```

### 4. Crea un cliente con su límite de crédito (crea la cuenta corriente junto con él)

```bash
curl -X POST http://localhost:4000/clientes \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Cliente Uno","email":"cliente@mail.com","telefono":"123","limiteCredito":50000}'
```

### 5. Registra un ticket de venta (se suma al saldo)

```bash
curl -X POST http://localhost:4000/clientes/ID_CLIENTE/movimientos \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"ticket","items":[{"producto":"ID_PRODUCTO","cantidad":2}],"pagado":2000}'
```

Días después, otro ticket del mismo cliente → se suma al mismo saldo (no crea otra cuenta).

### 6. Registra un pago (resta del saldo)

```bash
curl -X POST http://localhost:4000/clientes/ID_CLIENTE/movimientos \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"tipo":"pago","monto":10000,"metodoPago":"efectivo"}'
```

### 7. Ver la cuenta corriente completa (saldo + historial)

```bash
curl http://localhost:4000/clientes/ID_CLIENTE/cuenta-corriente \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

## Autenticación

> **[doc/BACKLOG.md](doc/BACKLOG.md)** — el orden en que se construye la app,
> etapa por etapa, con el detalle de cada endpoint y lo que falta. **Empezá por acá.**
>
> [doc/CLIENTES.md](doc/CLIENTES.md) — sección Clientes, lista para aplicar
> · [doc/README-FRONTEND.md](doc/README-FRONTEND.md) — cliente HTTP y servicio de auth
> · [doc/GOOGLE_AUTH.md](doc/GOOGLE_AUTH.md) — login con Google en Expo
>
> ⚠ Las dos guías de arriba documentan el contrato **anterior** a la
> reescritura del core (hablan de `movimientos` y `cuenta-corriente`). Se
> actualizan a medida que el backlog avanza por cada etapa.

Todos estos endpoints son públicos salvo los marcados con 🔒 (piden
`Authorization: Bearer <token>`).

| Método | Ruta | Body | Devuelve |
| --- | --- | --- | --- |
| POST | `/auth/registro` | `{ nombre, email, password }` | `{ token, usuario }` |
| POST | `/auth/google` | `{ idToken }` | `{ token, usuario, caso }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, usuario }` |
| GET | `/auth/me` 🔒 | — | `{ usuario }` |
| POST | `/auth/recuperar-password` | `{ email }` | `{ mensaje }` |
| GET | `/auth/recuperar-password/:token` | — | `{ valido, email }` |
| POST | `/auth/resetear-password` | `{ token, password }` | `{ token, usuario }` |
| POST | `/auth/cambiar-password` 🔒 | `{ passwordActual, passwordNueva }` | `{ token, usuario }` |

### Registro

Cualquiera puede registrarse y queda con rol `administrador`, con sus clientes y
productos aislados del resto. **El `rol` nunca se toma del body**: mandar
`{"rol":"super_admin"}` no tiene efecto.

La contraseña necesita 6 caracteres como mínimo. Si el email ya existe devuelve
400 con `"Ya hay una cuenta registrada con ese email"`.

### Recuperación de contraseña — los 3 pasos del front

```
1. View "olvidé mi contraseña"
   POST /auth/recuperar-password  { email }
   → 200 siempre, exista o no el email (para no filtrar quién está registrado)
   → manda un mail con <FRONTEND_URL>/resetear-password?token=xxx

2. View "resetear" (al abrir el link, antes de mostrar el formulario)
   GET /auth/recuperar-password/:token
   → 200 { valido: true, email } | 400 "El link no es válido o ya venció"

3. Submit del formulario
   POST /auth/resetear-password  { token, password }
   → 200 { token, usuario }  ← el usuario queda logueado, no hace falta ir al login
```

El token vive **60 minutos** y es de **un solo uso**. En la base se guarda su
hash SHA-256, no el token, así que ni leyendo la base se puede reutilizar.

Al cambiar la contraseña (por reseteo o por `/auth/cambiar-password`) **los JWT
emitidos antes quedan invalidados**: las sesiones abiertas en otros dispositivos
reciben 401 con `"Tu contraseña cambió, iniciá sesión de nuevo"`.

### Envío de mails

Con las variables `MAIL_*` en el `.env` los mails salen de verdad (nodemailer).
Sin ellas el sistema funciona igual y **el mail se imprime en la consola** con el
link incluido, así se puede probar todo el flujo sin configurar nada:

```
18:16:13 INFO  📧 Email (no enviado, SMTP sin configurar)
18:16:13 INFO     para:   ana@tienda.com
18:16:13 INFO     asunto: Recuperá tu contraseña
18:16:13 INFO     Hola Ana, para recuperar tu contraseña entrá acá (vence en 60 minutos):
                  http://localhost:5173/resetear-password?token=10c723...
```

Las plantillas están en `src/utils/email.ts`. Al arrancar, el server verifica el SMTP
y avisa en consola si las credenciales están mal.

### Rate limit

`src/middleware/rateLimit.ts` limita por IP: 10 intentos cada 15 min en `/auth/login`,
5 cada 15 min en `/auth/recuperar-password`, 10 por hora en `/auth/registro`.
Al superarlo devuelve 429 con el header `Retry-After`. Un login exitoso resetea
el contador. Es en memoria: con más de una instancia del server hay que moverlo
a Redis.

## Endpoints completos

```
POST   /auth/registro
POST   /auth/google
POST   /auth/login
GET    /auth/me
POST   /auth/recuperar-password
GET    /auth/recuperar-password/:token
POST   /auth/resetear-password
POST   /auth/cambiar-password

GET    /usuarios                          (solo super_admin)
POST   /usuarios                          (solo super_admin)
DELETE /usuarios/:id                      (solo super_admin)

GET    /productos
GET    /productos/:id
POST   /productos
PUT    /productos/:id
DELETE /productos/:id

GET    /clientes
GET    /clientes/:id
POST   /clientes                          (crea cliente + cuenta corriente)
PUT    /clientes/:id
PUT    /clientes/:id/limite-credito

GET    /clientes/:id/cuenta-corriente     (saldo + historial de movimientos)
POST   /clientes/:id/movimientos          (registra un ticket o un pago)
DELETE /movimientos/:id                   (anula movimiento, recalcula saldo)

GET    /clientes/:id/facturas/preview     (vista previa del período)
POST   /clientes/:id/facturas             (emite la factura del período)
GET    /clientes/:id/facturas             (historial del cliente)
GET    /facturas                          (todas las del negocio)
GET    /facturas/:id                      (detalle con tickets y productos)
PUT    /facturas/:id/pagada
DELETE /facturas/:id                      (anula y libera los tickets)
```
# FACTURACION-BACK
