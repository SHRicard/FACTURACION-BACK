# Mescla: toda la documentación de Cuenta Corriente

Un solo archivo con el README del backend y todas las guías de `doc/`, en el
orden en que conviene leerlas. El contenido es el mismo de cada archivo; los
links entre guías apuntan a la sección correspondiente de este archivo.

## Índice

1. [Visión general del backend](#visión-general-del-backend) · _README.md_
2. [Backlog](#backlog) · _doc/BACKLOG.md_
3. [Marcas](#marcas) · _doc/MARCAS.md_
4. [Sección Clientes](#sección-clientes) · _doc/CLIENTES.md_
5. [Sección Especies](#sección-especies) · _doc/ESPECIES.md_
6. [El ticket — CRUD completo](#el-ticket--crud-completo) · _doc/CREATE_TICK.md_
7. [Vista de facturación](#vista-de-facturación) · _doc/FACTURAS.md_
8. [Registrar un pago](#registrar-un-pago) · _doc/REGISTRO_PAGO.md_
9. [La factura en PDF](#la-factura-en-pdf) · _doc/FACTURA_PDF.md_
10. [Guía de integración con el frontend](#guía-de-integración-con-el-frontend) · _doc/README-FRONTEND.md_
11. [Login con Google](#login-con-google) · _doc/GOOGLE_AUTH.md_

---

## Visión general del backend

Backend con **TypeScript + Node.js + Express + MongoDB (Mongoose) + JWT**, para
llevar la libreta del fiado: clientes, los tickets de lo que se llevan y los
pagos con que lo van saldando. Todo es de una **marca** (el negocio), que puede
tener varios dueños, y la factura sale en PDF con el nombre, el logo y los
colores de esa marca.

### Instalación

```bash
npm install
```

### Estructura

```
src/
  server.ts          arranque y wiring de middlewares
  config/            conexión a MongoDB y declaración de roles
  models/            schemas de mongoose, con sus interfaces
  routes/            endpoints
  services/          lógica del negocio: facturación, pagos, marcas, PDF, links, Cloudinary
  middleware/        auth, marca, rate limit, logger de requests, errorHandler
  pdf/               la factura en PDF: documento, paleta de colores y motor (pdfmake)
  emails/            plantillas de mail, layout, tokens de diseño y assets (fuentes, logo)
  utils/             logger, AppError, asyncHandler, email, fechas, formato, colores, validaciones
  types/             tipos compartidos y augmentación de Express
scripts/             mantenimiento de datos (ver abajo)
doc/                 guías por sección, para el front
dist/                salida de tsc (generada, no se versiona)
```

#### Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Corre los `.ts` con tsx en modo watch, sin compilar |
| `npm run build` | Compila `src/` → `dist/` y copia los assets de los mails |
| `npm start` | Corre `dist/server.js` (necesita `build` antes) |
| `npm run typecheck` | Verifica tipos sin generar archivos |
| `npm run clean` | Borra `dist/` |

El `tsconfig.json` va con `strict` activado, más `noUncheckedIndexedAccess` y
`noImplicitOverride`. Los imports relativos llevan extensión `.js` aunque el
archivo sea `.ts`: es lo que exige `module: NodeNext`, porque es la ruta que Node
va a resolver en tiempo de ejecución.

#### Scripts de datos

| Comando | Qué hace |
| --- | --- |
| `node scripts/sembrar-especies.mjs <email>` | Carga la lista inicial de especies en la marca de ese dueño. Es idempotente: no duplica ni pisa |
| `node scripts/reiniciar-datos.mjs --confirmar` | Hace un respaldo con `mongodump` en `respaldos/` y borra los datos del negocio. Los usuarios quedan. No corre con `NODE_ENV=production` |

Para volver atrás un respaldo: `mongorestore --drop respaldos/<carpeta>`.

### Configuración

1. Copiá `.env.example` como `.env`
2. Completá `MONGO_URI`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD`.
   Para la factura en PDF sumá `API_PUBLIC_URL` (la URL pública de esta API, de
   donde sale el link que abre el cliente) y las `CLOUDINARY_*` (el logo de cada
   marca). Las dos son opcionales en desarrollo: ver
   [doc/FACTURA_PDF.md](#variables-de-entorno).

### Correr el servidor

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
**Con `npm start` el server corre `dist/`: después de cambiar código hay que
volver a compilar y reiniciar.**

Si en la base no hay ningún `super_admin`, al arrancar se crea uno con el
email/password de `.env`.

### Documentación

> **[doc/BACKLOG.md](#backlog)**: el orden en que se construye la app,
> etapa por etapa, con el detalle de cada endpoint y lo que falta. **Empezá por acá.**
>
> - [doc/CLIENTES.md](#sección-clientes): sección Clientes, lista para aplicar
> - [doc/ESPECIES.md](#sección-especies): sección Especies
> - [doc/CREATE_TICK.md](#el-ticket--crud-completo): **el ticket** (alta, edición y anulación)
> - [doc/FACTURAS.md](#vista-de-facturación): **vista de facturación** (listado y detalle)
> - [doc/REGISTRO_PAGO.md](#registrar-un-pago): **registrar un pago** (completo, parcial, repartido y anulado)
> - [doc/FACTURA_PDF.md](#la-factura-en-pdf): **la factura en PDF** (compartir, WhatsApp, mail, logo y colores)
> - [doc/MARCAS.md](#marcas): **las marcas** (onboarding con DNI + marca, dueños, logo, colores y estadísticas)
> - [doc/README-FRONTEND.md](#guía-de-integración-con-el-frontend): cliente HTTP y servicio de auth
> - [doc/GOOGLE_AUTH.md](#login-con-google): login con Google en Expo
>
> ⚠ `README-FRONTEND.md` y `GOOGLE_AUTH.md` cubren solo autenticación, que no
> cambió. Las guías de secciones están al día.

### Logs y manejo de errores

Todos los errores se loguean en la consola y se responden en un formato único.
Las piezas están en `utils/` y `middleware/`:

| Archivo | Para qué sirve |
| --- | --- |
| `src/utils/logger.ts` | `logger.debug/info/warn/error/success`. Si le pasás un `Error` imprime el stack ya filtrado. |
| `src/utils/asyncHandler.ts` | Envuelve handlers async para que sus errores lleguen al middleware de errores. |
| `src/utils/AppError.ts` | `AppError` + atajos `noEncontrado`, `datosInvalidos`, `noAutorizado`, `prohibido`. |
| `src/middleware/requestLogger.ts` | Una línea por request: método, ruta, status, duración, usuario y motivo del error. |
| `src/middleware/errorHandler.ts` | Traduce el error a status + JSON y lo loguea. Va último en `server.ts`. |

#### Cómo escribir una ruta

```ts
import { asyncHandler } from "../utils/asyncHandler.js";
import { noEncontrado } from "../utils/AppError.js";
import type { RequestConMarca } from "../types/index.js";

// En las rutas del negocio (detrás de requireAuth + requireMarca) se le pasa
// RequestConMarca: req.usuario y req.marca dejan de ser opcionales.
router.get("/:id", asyncHandler<RequestConMarca>(async (req, res) => {
  const cliente = await Cliente.findOne({
    _id: req.params["id"],
    marca: req.marca._id,   // ← todo se filtra por la marca, no por el usuario
  });
  if (!cliente) throw noEncontrado("Cliente");   // → 404
  res.json(cliente);                             // ← acá ya no es null
}));
```

Sin `try/catch`: cualquier error que se escape lo agarra `errorHandler`, que lo
imprime en consola y responde el JSON. **Si olvidás el `asyncHandler`, un error
async deja la request colgada sin loguear nada.** Es la única regla a respetar.

#### Qué ves en la consola

```
17:40:30 DEBUG POST   /clientes/68b.../tickets 201 15.8ms (admin@tuapp.com)
17:40:30 WARN  PUT    /marcas/mia 400 3.1ms (admin@tuapp.com) — El campo "colorPrimario" tiene que ser un color hex, como #4a1866
17:40:54 ERROR TypeError: Cannot read properties of undefined (reading 'nombre')
    at file:///.../src/routes/clientes.ts:31:30
17:40:54 ERROR   request: { params: {}, body: { email: 'a@b.com', password: '***' }, usuario: null }
```

Los errores 4xx ocupan una línea. Los 5xx (bugs) imprimen el stack completo más
los `params`, `query`, `body` y usuario de la request. Las claves que matcheen
`password`, `token`, `secret`, `authorization` o `jwt` salen como `***`.

#### Nivel de detalle

`LOG_LEVEL` acepta `debug | info | warn | error | silent`. Por defecto es `debug`
en desarrollo e `info` con `NODE_ENV=production` (ahí las requests exitosas dejan
de loguearse y solo quedan los errores).

#### Códigos de respuesta

| Situación | Status | Body |
| --- | --- | --- |
| Validación de mongoose | 400 | `{ error: "Datos inválidos", detalles: { campo: "motivo" } }` |
| ObjectId mal formado | 400 | `{ error: 'El valor de "_id" no es válido' }` |
| Índice único repetido | 409 | `{ error: "Ya existe un registro con ese email" }` |
| Token ausente/inválido/vencido | 401 | `{ error: "Token inválido" }` |
| Falta DNI o marca | 403 | `{ error, detalles: { pendiente: "perfil" \| "marca" } }` |
| Ruta inexistente | 404 | `{ error: "Ruta no encontrada: GET /x" }` |
| Bug del servidor | 500 | `{ error: "Error interno del servidor", stack: [...] }` |

El `stack` solo se manda al cliente en los 500 y fuera de producción.

### Roles

Se declaran en un solo lugar: [`src/config/roles.ts`](src/config/roles.ts). El
enum del schema de mongoose, el rol por defecto y el middleware salen todos de
ahí.

En el MVP hay **dos**:

| Rol | Qué puede hacer |
| --- | --- |
| `super_admin` | Administra la plataforma. Único que entra a `/usuarios` para crear y borrar cuentas, y a `GET /marcas` para ver todas las marcas. No tiene marca ni opera el negocio. |
| `administrador` | Dueño de una **marca** (el negocio). Gestiona los clientes, especies, tickets y pagos de su marca, que puede compartir con otros dueños. No ve los datos de otras marcas. |

**Todo usuario que se registra queda como `administrador`**, tanto por
`/auth/registro` como por `/auth/google`. El rol nunca se lee del body: si no,
cualquiera se daría de alta como `super_admin`. La única forma de asignar otro
rol es `POST /usuarios`, que solo puede llamar un `super_admin`.

El aislamiento **no depende del rol sino del dato**: todo lo del negocio es de
una **marca**, y cada query filtra por `marca: req.marca._id` (lo carga el
middleware `requireMarca`). Los dueños de una misma marca ven y hacen lo mismo;
dos marcas distintas nunca se cruzan. Sin DNI o sin marca, las rutas del
negocio responden `403` con `detalles.pendiente`. Ver [doc/MARCAS.md](#marcas).

#### Proteger una ruta por rol

```ts
import { requireAuth, requireRol } from "../middleware/auth.js";

router.use(requireAuth, requireRol("super_admin"));
// requireSuperAdmin es un atajo de esto mismo
```

#### Agregar un rol nuevo

Está planificado sumar **`cliente`** más adelante (que el cliente final entre a
ver su propia cuenta corriente). Cuando llegue el momento:

1. Sumarlo a `ROLES` en `src/config/roles.ts`.
2. Describirlo en `DESCRIPCION_ROLES`. TypeScript lo va a exigir, no se puede olvidar.
3. Proteger las rutas con `requireRol("cliente")`.

No hay que tocar el modelo ni escribir un middleware nuevo.

### La marca: logo y colores

La marca es el negocio. Tiene nombre, dirección, teléfono, **un logo** (en
Cloudinary) y **dos colores**, y todo eso sale en el PDF que recibe el cliente,
nunca la marca de la app.

| Campo | Formato | Para qué |
| --- | --- | --- |
| `nombre` | Texto, hasta 80. Requerido | Va grande en el PDF |
| `direccion` | Texto, hasta 120 | Encabezado del PDF |
| `telefono` | Texto, hasta 40 | Encabezado del PDF |
| `logoUrl` | Lo arma el backend (`/marcas/mia/logo`) | Encabezado del PDF |
| `colorPrimario` | Hex: `#1e3a8a`, `1E3A8A` o `#abc` | Nombre de la marca, saldo grande, títulos, línea del total, rótulo "PAGADA" |
| `colorSecundario` | Hex, mismo formato | "SALDO A PAGAR", montos de los pagos, rótulo "VENCE EL…", barra de lo cobrado |

**Cómo se guardan los colores:**

- Se normalizan a `#rrggbb` en minúscula. Un valor que no es hex responde `400`.
- Son opcionales. Sin colores, el PDF sale con la paleta de la app (los
  violetas). Con uno solo, el otro toma el mismo.
- En `PUT /marcas/mia`, los textos se reemplazan (el front manda el formulario
  como quedó), pero **los colores solo cambian si vienen en el body**. Para
  sacar uno se manda `null` o `""`.

**Cómo los usa el PDF** ([`src/pdf/paleta.ts`](src/pdf/paleta.ts)):

- El fondo y los bordes del bloque del saldo son un tono muy claro del primario.
- Un color muy claro (un amarillo, por ejemplo) **se oscurece para el texto**
  hasta tener contraste 4.5 sobre blanco: el cliente tiene que poder leer
  cuánto debe. La barra conserva el color tal cual, salvo que se pierda en el
  blanco.
- "Vencida" sigue en ámbar: es un aviso, no un color de la marca.

Detalle completo en [doc/MARCAS.md](#marcas) y
[doc/FACTURA_PDF.md](#los-colores-de-la-marca).

### Flujo típico

#### 1. Registro / Login

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

Ambos devuelven `{ token, usuario, pendiente }`. Usá el token en el header
`Authorization: Bearer <token>` en todas las demás requests.

#### 1b. Completa su perfil y crea su marca (obligatorio)

`pendiente` dice qué le falta antes de poder operar: `"perfil"` (el DNI),
`"marca"`, o `null`.

```bash
curl -X PUT http://localhost:4000/auth/me/perfil \
  -H "Authorization: Bearer TOKEN_ADMIN" -H "Content-Type: application/json" \
  -d '{"dni":"30111222"}'

# O crea su marca, con sus dos colores…
curl -X POST http://localhost:4000/marcas \
  -H "Authorization: Bearer TOKEN_ADMIN" -H "Content-Type: application/json" \
  -d '{"nombre":"BebyRo","telefono":"11 4444-5555","colorPrimario":"#1e3a8a","colorSecundario":"#f59e0b"}'

# …o un dueño de una marca existente lo suma con su DNI
curl -X POST http://localhost:4000/marcas/mia/duenos \
  -H "Authorization: Bearer TOKEN_DE_UN_DUENO" -H "Content-Type: application/json" \
  -d '{"dni":"30111222"}'
```

Los colores se pueden cambiar después con `PUT /marcas/mia`, y el logo se sube
con `POST /marcas/mia/logo/firma` + `PUT /marcas/mia/logo`.

#### 2. Super admin crea un administrador

```bash
curl -X POST http://localhost:4000/usuarios \
  -H "Authorization: Bearer TOKEN_SUPER_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan","email":"juan@tienda.com","password":"123456"}'
```

#### 3. El administrador (logueado) crea sus especies

Los tipos de mercadería que maneja. Se cargan una vez, y son lo único que hace
falta tener antes de vender: **no se dan de alta productos**.

```bash
curl -X POST http://localhost:4000/especies \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Pantalón"}'
```

#### 4. Crea un cliente con su ventana de pago (le abre la primera factura)

```bash
curl -X POST http://localhost:4000/clientes \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Cliente Uno","dni":"33333333","telefono":"123","limiteCredito":50000}'
```

#### 5. Registra un ticket (la compra fiada)

El ítem se escribe acá mismo: nombre, talle y precio del día, más la especie.

```bash
curl -X POST http://localhost:4000/clientes/ID_CLIENTE/tickets \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{
        "items": [
          {"nombre":"Pantalón largo","talle":"34","especie":"ID_ESPECIE","cantidad":1,"precioUnitario":50000}
        ],
        "pagado": 9000
      }'
```

Se pega solo a la factura abierta del cliente. Si esa factura ya venció, se
cierra y se abre la del período siguiente.

#### 6. Registra un pago a cuenta

```bash
curl -X POST http://localhost:4000/clientes/ID_CLIENTE/pagos \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"monto":10000,"metodoPago":"efectivo"}'
```

Se reparte desde la factura más vieja con saldo: primero se salda lo que se debe
hace más tiempo, y si sobra sigue con la siguiente. Para pagar una factura
puntual, `POST /facturas/ID_FACTURA/pagos`. Todo el detalle en
[doc/REGISTRO_PAGO.md](#registrar-un-pago).

#### 7. Ver la cuenta abierta (saldo + tickets + pagos)

```bash
curl http://localhost:4000/clientes/ID_CLIENTE/factura-actual \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

#### 8. Mandarle la factura en PDF, con los colores de la marca

```bash
# Descargar el PDF
curl http://localhost:4000/facturas/ID_FACTURA/pdf \
  -H "Authorization: Bearer TOKEN_ADMIN" -o factura.pdf

# O generar el link público + el mensaje de WhatsApp
curl -X POST http://localhost:4000/facturas/ID_FACTURA/enlace \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

El PDF no se guarda en ningún lado: se arma en el momento con los datos al día.
Ver [doc/FACTURA_PDF.md](#la-factura-en-pdf).

### Autenticación

Todos estos endpoints son públicos salvo los marcados con 🔒 (piden
`Authorization: Bearer <token>`).

| Método | Ruta | Body | Devuelve |
| --- | --- | --- | --- |
| POST | `/auth/registro` | `{ nombre, email, password }` | `{ token, usuario, pendiente }` |
| POST | `/auth/google` | `{ idToken }` | `{ token, usuario, caso, pendiente }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, usuario, pendiente }` |
| GET | `/auth/me` 🔒 | — | `{ usuario }` |
| POST | `/auth/recuperar-password` | `{ email }` | `{ mensaje }` |
| GET | `/auth/recuperar-password/:token` | — | `{ valido, email }` |
| POST | `/auth/resetear-password` | `{ token, password }` | `{ token, usuario }` |
| POST | `/auth/cambiar-password` 🔒 | `{ passwordActual, passwordNueva }` | `{ token, usuario }` |
| PUT | `/auth/me/perfil` 🔒 | `{ dni }` | `{ usuario, pendiente }` |

**`pendiente`** vale `"perfil"` si falta el DNI, `"marca"` si falta la marca y
`null` si ya puede operar. `GET /auth/me` suma la **marca** con sus dueños. Todo
lo de la marca (crearla, sumar dueños, logo y colores) está en
[doc/MARCAS.md](#marcas).

#### Registro

Cualquiera puede registrarse y queda con rol `administrador`. Sus datos quedan
aislados en su marca. **El `rol` nunca se toma del body**: mandar
`{"rol":"super_admin"}` no tiene efecto.

La contraseña necesita 6 caracteres como mínimo. Si el email ya existe devuelve
400 con `"Ya hay una cuenta registrada con ese email"`.

#### Recuperación de contraseña: los 3 pasos del front

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

#### Envío de mails

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

Las plantillas están en `src/emails/plantillas/` (bienvenida, recuperar
contraseña, contraseña cambiada y la factura al cliente) y el envío en
`src/utils/email.ts`. Al arrancar, el server verifica el SMTP y avisa en consola
si las credenciales están mal.

#### Rate limit

`src/middleware/rateLimit.ts` limita por IP: 10 intentos cada 15 min en `/auth/login`,
5 cada 15 min en `/auth/recuperar-password`, 10 por hora en `/auth/registro`,
20 mails de factura por hora (`/facturas/:id/enviar`), 30 firmas de logo por hora
y 30 aperturas de link público cada 15 min (`/publico/facturas/:token`).
Al superarlo devuelve 429 con el header `Retry-After`. Un login exitoso resetea
el contador. Es en memoria: con más de una instancia del server hay que moverlo
a Redis.

### Endpoints completos

```
POST   /auth/registro
POST   /auth/google
POST   /auth/login
GET    /auth/me
POST   /auth/recuperar-password
GET    /auth/recuperar-password/:token
POST   /auth/resetear-password
POST   /auth/cambiar-password
PUT    /auth/me/perfil                    (el DNI, una sola vez)

POST   /marcas                            (crear la marca propia: nombre, dirección, teléfono y colores)
GET    /marcas                            (solo super_admin: todas, con dueños y números)
GET    /marcas/mia                        (la marca, sus dueños y estadísticas)
PUT    /marcas/mia                        (nombre, dirección, teléfono y colores)
POST   /marcas/mia/logo/firma             (firma para subir el logo a Cloudinary)
PUT    /marcas/mia/logo                   (guarda el logo ya subido)
DELETE /marcas/mia/logo
POST   /marcas/mia/duenos                 (sumar un dueño por DNI)
DELETE /marcas/mia/duenos/:usuarioId      (sacar a un dueño, o irse)

GET    /usuarios                          (solo super_admin)
POST   /usuarios                          (solo super_admin)
PUT    /usuarios/:id/dni                  (solo super_admin: corrige un DNI)
DELETE /usuarios/:id                      (solo super_admin; no al único dueño de una marca)

GET    /especies
POST   /especies
PUT    /especies/:id
DELETE /especies/:id

GET    /productos                         (lista de precios opcional, fuera del flujo)
GET    /productos/:id
POST   /productos
PUT    /productos/:id
DELETE /productos/:id

GET    /clientes
GET    /clientes/:id
POST   /clientes                          (crea cliente + su primera factura)
PUT    /clientes/:id                      (parcial: el límite va acá también)

GET    /clientes/:id/factura-actual       (la cuenta abierta, con tickets y pagos)
POST   /clientes/:id/tickets              (compra fiada: ítems escritos + especie)
GET    /tickets/:id
PUT    /tickets/:id                       (corrige: reemplaza los renglones)
DELETE /tickets/:id                       (baja lógica: queda tachado)
POST   /clientes/:id/pagos                (entrega a cuenta: se reparte de la más vieja a la más nueva)
POST   /facturas/:id/pagos                (pago a una factura puntual, completo o parcial)
DELETE /pagos/:id                         (baja lógica: anula la entrega entera)

GET    /clientes/:id/facturas             (historial del cliente)
GET    /facturas                          (paginado: ?estado= ?cliente= ?vencidas= ?buscar=)
GET    /facturas/vencidas                 (cola de cobranza)
GET    /facturas/:id                      (detalle: factura + tickets + pagos + cliente)
POST   /facturas/:id/cerrar
PUT    /facturas/:id/pagada

GET    /facturas/:id/pdf                  (la factura en PDF, con el nombre, el logo y los colores de la marca)
GET    /clientes/:id/factura-actual/pdf   (la cuenta abierta en PDF)
POST   /facturas/:id/enviar               (por mail, con el PDF adjunto)
POST   /facturas/:id/enlace               (link público + mensaje de WhatsApp)
DELETE /facturas/:id/enlace               (da de baja los links mandados)
GET    /publico/facturas/:token           (SIN login: lo que abre el cliente)
```

---

## Backlog

El orden en que se construye la app, siguiendo el flujo real del administrador.
Cada etapa se detalla **cuando llegamos a ella**, no antes.

- ✅ hecho y probado · 🔨 en curso · ⬜ pendiente · 📄 falta documentar

---

### El mapa

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

### Estado por etapa

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

### Inventario: todo lo que ya existe en el backend

Está **escrito y probado**, pero solo lo marcado con ✅ tiene documentación
detallada. El resto funciona; simplemente todavía no le tocó el turno.

Leyenda: ✅ detallado acá · 📘 documentado en otra guía · ⬜ sin documentar

#### Autenticación — 8 endpoints

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

📘 en [README-FRONTEND.md](#guía-de-integración-con-el-frontend) y [GOOGLE_AUTH.md](#login-con-google).

#### Clientes — 4 endpoints · Etapa 1

| | Endpoint |
| --- | --- |
| ✅ | `POST /clientes` |
| ✅ | `GET /clientes` |
| ✅ | `GET /clientes/:id` |
| ✅ | `PUT /clientes/:id` |

#### Especies — 4 endpoints · Etapa 2

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `GET /especies` | Los tipos: Pantalón, Pantalón corto, Zapatilla, Media |
| ✅ | `POST /especies` | |
| ✅ | `PUT /especies/:id` | También sirve para desactivar |
| ✅ | `DELETE /especies/:id` | Rechaza si algún ticket la nombra |

📄 [ESPECIES.md](#sección-especies) — la guía de la sección, lista para aplicar.

> Antes se llamaba **catálogo** y vivía en `/catalogos`. Se renombró el 08/09,
> junto con sacar el inventario del medio. La migración de datos está en
> [scripts/migrar-especies.mjs](../scripts/migrar-especies.mjs).

#### Productos — 5 endpoints · fuera del flujo

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

#### Tickets y pagos — 3 endpoints · Etapa 3

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `POST /clientes/:id/tickets` | La compra fiada. Ítems escritos a mano + especie |
| ✅ | `GET /tickets/:id` | Uno solo |
| ✅ | `PUT /tickets/:id` | Corregirlo. Reemplaza los renglones completos |
| ✅ | `POST /clientes/:id/pagos` | Entrega plata a cuenta. Se reparte de la factura más vieja a la más nueva |
| ✅ | `POST /facturas/:id/pagos` | Pago a una factura puntual, completo o parcial |
| ✅ | `DELETE /pagos/:id` | **Baja lógica.** Anula la entrega entera |
| ✅ | `DELETE /tickets/:id` | **Baja lógica.** Queda tachado y deja de sumar |

📄 [CREATE_TICK.md](#el-ticket--crud-completo) — el CRUD completo del ticket.
📄 [REGISTRO_PAGO.md](#registrar-un-pago) — registrar, repartir y anular pagos.

#### Facturas — 6 endpoints · Etapa 5

| | Endpoint | Qué hace |
| --- | --- | --- |
| ✅ | `GET /clientes/:id/factura-actual` | La cuenta abierta, con sus tickets y pagos |
| ✅ | `GET /clientes/:id/facturas` | Historial del cliente |
| ✅ | `GET /facturas` | Todas las del negocio. Paginado, con `?estado= ?cliente= ?vencidas= ?buscar=` |
| ✅ | `GET /facturas/vencidas` | Las que pasaron su fecha y siguen con saldo |
| ✅ | `GET /facturas/:id` | Detalle con tickets, pagos y cliente |
| ⬜ | `POST /facturas/:id/cerrar` | Cerrarla antes de que venza |
| ⬜ | `PUT /facturas/:id/pagada` | Marcarla saldada |

#### Usuarios (solo super_admin) — 3 endpoints

| | Endpoint |
| --- | --- |
| ⬜ | `GET /usuarios` · `POST /usuarios` · `DELETE /usuarios/:id` |

Es administración de la plataforma, no del negocio. Fuera del flujo del
administrador, por eso no tiene etapa propia.

#### Colecciones ⬜

Ninguna tiene su schema documentado todavía. Los campos de `Cliente` se pueden
deducir de la Etapa 1, pero `Factura` (estados, los cinco totales distintos),
`Ticket`, `Pago` y `Especie` no están escritos en ningún lado.

- [ ] Documentar los schemas de las colecciones, con qué significa cada campo

---

## Etapa 1 — Clientes

Todo arranca acá: sin cliente no hay a quién fiarle.

> 📄 **[CLIENTES.md](#sección-clientes)** — la guía limpia y autocontenida de esta
> sección, lista para aplicar. Lo de acá abajo es el detalle del backlog.

Base: `http://localhost:4000` · Todos los endpoints piden
`Authorization: Bearer <token>`.

### Paso 1.1 — Crear cliente ✅

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

#### Errores

| Caso | Status | Respuesta |
| --- | --- | --- |
| Falta nombre | 400 | `{ error: "Datos inválidos", detalles: { nombre: "Path \`nombre\` is required." } }` |
| Falta DNI | 400 | igual, con `detalles.dni` |
| DNI repetido en el negocio | 409 | `{ error: "Ya existe un registro con ese dni" }` |
| `desdeDia` > `hastaDia` | 400 | `{ error: "El día de inicio de la ventana no puede ser posterior al de fin" }` |
| Día fuera de 1–31 | 400 | `{ error: "Los días de la ventana de pago tienen que estar entre 1 y 31" }` |

> El DNI es único **por negocio**: dos tiendas distintas pueden tener al mismo
> cliente sin pisarse.

#### Para el front

- [ ] Formulario con nombre y DNI obligatorios
- [ ] Selector de ventana de pago (dos días del mes). Sugerir 1–10 por defecto
- [ ] Mostrar `detalles` bajo cada campo cuando viene un 400
- [ ] El 409 de DNI va bajo el campo DNI, no como error general

### Paso 1.2 — Listar clientes ✅

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

#### Para el front

- [ ] Lista con nombre, DNI, teléfono y deuda
- [ ] Destacar a los que deben (`deuda > 0`)
- [ ] Alertar a los que superaron su límite (`limiteCredito > 0 && deuda > limiteCredito`)
- [ ] Marcar en rojo a los que tienen `facturasVencidas > 0`
- [ ] Buscador que pega a `?buscar=` con debounce (~300 ms)
- [ ] Scroll infinito o paginador usando `pagina` / `paginas`
- [ ] Chips de filtro: "Solo deudores", "Solo vencidos"

### Paso 1.3 — Ver detalle ✅

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

#### Para el front

- [ ] Ficha con los datos y la deuda arriba de todo
- [ ] Tarjeta de la factura abierta: saldo, vencimiento, `diasParaVencer`
- [ ] Usar `estadoVisible`, no `estado`: "vencida" se calcula y no está en `estado`
- [ ] Botones: editar, cargar ticket, registrar pago

#### Falta en el backend

- [ ] Traer el **historial de facturas** en el mismo detalle, o dejarlo aparte
      (ya existe `GET /clientes/:id/facturas`)

### Paso 1.4 — Editar cliente ✅

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

#### Para el front

- [ ] Mismo formulario que crear, precargado
- [ ] Avisar que cambiar la ventana no mueve el vencimiento de la factura actual

### Eliminar cliente — descartado

**No se implementa.** Borrar un cliente se lleva su historial de compras y con
él las métricas de ese período. Cuando haga falta sacarlo de la lista va a ser
una baja lógica (`activo: false`), no un borrado real.

---

### El servicio del front

Va sobre el `client.ts` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend), que ya
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

#### Cómo usarlo

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

#### Checklist del front

- [ ] `clientes.service.ts` copiado al proyecto
- [ ] Pantalla de listado con buscador y paginación
- [ ] Pantalla de alta con validación de nombre y DNI
- [ ] Selector de ventana de pago
- [ ] Pantalla de detalle con la deuda y la factura abierta
- [ ] Edición reusando el formulario de alta

---

### Pendientes de la Etapa 1

- [x] ~~Búsqueda por nombre/DNI en el listado~~ ✅
- [x] ~~Paginación~~ ✅
- [x] ~~Filtros: deudores, vencidos~~ ✅
- [x] ~~Servicio del front~~ ✅
- [x] ~~Decidir borrado real vs. baja lógica~~ → **no se borra**, decidido el 06/09
- [ ] Decidir si cambiar la ventana de pago debe recalcular la factura ya abierta
      (hoy solo afecta a las siguientes)

Cuando cerremos estos, pasamos a la **Etapa 2 — Especies**.

---

### Etapas siguientes

Se detallan al llegar. Por ahora solo el título y qué resuelve cada una.

#### Etapa 2 — Especies ✅ documentada
Los tipos de mercadería (Pantalón, Pantalón corto, Zapatilla, Media). CRUD
completo. Es lo único que se carga antes de vender, y lo que después permite
saber qué se vende más sin importar cómo se haya escrito cada ítem.

📄 **[ESPECIES.md](#sección-especies)** — endpoints, errores, servicio del front y
checklist de la pantalla. Verificado contra la API el 08/09.

Pendientes:

- [ ] Pantallas del front (listado, alta/edición, borrar-o-desactivar)
- [ ] Decidir si `GET /especies` debería aceptar `?activo=true` en vez de que
      el front filtre. Hoy filtra el front

#### Etapa 3 — Tickets 🔨
La compra fiada. El ítem se escribe en el momento — nombre, talle, precio — y se
le elige la especie. Se pega solo a la factura abierta del cliente. Incluye el
pago parcial ("se lleva $5000 y deja $2000").

📄 **[CREATE_TICK.md](#el-ticket--crud-completo)** — el CRUD completo, verificado contra la
API el 08/09: alta, lectura, edición y anulación por baja lógica, con el
servicio del front y el diseño de la pantalla.

- [x] ~~Alta~~ · ~~Edición~~ · ~~Anulación (baja lógica)~~ ✅ 08/09
- [ ] Pantallas del front (el checklist está en CREATE_TICK.md)
- [ ] Decidir si hace falta "desanular". Hoy no existe: se carga de nuevo

#### Etapa 4 — Factura 🔨 lectura documentada
El resumen del período. Se arma sola. Incluye el ciclo abierta → cerrada →
pagada y el rollover al vencer.

📄 **[FACTURAS.md](#vista-de-facturación)** — la vista de facturación (listado + detalle),
verificada contra la API el 08/09.

Falta documentar `POST /facturas/:id/cerrar` y `PUT /facturas/:id/pagada`.

#### Etapa 5 — Cobranza 🔨
Pagos a cuenta, listado de vencidas, avisos por WhatsApp o mail.

📄 **[REGISTRO_PAGO.md](#registrar-un-pago)** — registrar un pago completo o
parcial, a una factura o repartido entre varias, y anularlo. Verificado contra
la API el 10/09.

- [x] ~~Registrar pago (completo / parcial)~~ · ~~Repartir entre facturas~~ ·
      ~~Anular (baja lógica)~~ ✅ 10/09
- [ ] Pantallas del front (el checklist está en REGISTRO_PAGO.md)
- [ ] Decidir si hace falta cargar un pago con fecha anterior ("me dejó ayer")
- [ ] Avisos por WhatsApp o mail

#### La factura en PDF + la marca de cada usuario ✅ backend
📄 **[FACTURA_PDF.md](#la-factura-en-pdf)** — el PDF con la marca
(nombre y logo en Cloudinary), y los tres caminos para mandarlo: compartir
desde la app, link público por WhatsApp y mail. Verificado contra la API el 10/09.

- [x] ~~Marca por usuario (nombre + logo en Cloudinary)~~ · ~~PDF~~ ·
      ~~Link público~~ · ~~Mail con el PDF~~ ✅ 10/09
- [x] ~~Cargar las credenciales de Cloudinary en el `.env`~~ ✅ 11/09 ·
      la marca avisa con `puedeSubirLogo`
- [ ] Pantallas del front: "Mi marca" y los botones de la factura
- [ ] Decidir si la marca lleva también un color (hoy el PDF es violeta para todos)

#### Marcas con varios dueños ✅ backend
📄 **[MARCAS.md](#marcas)** — todo lo del negocio es de la marca, que puede
tener N dueños iguales. Onboarding obligatorio (DNI + marca), sumar dueños por
DNI, sacar e irse, logo por marca, estadísticas (clientes, vendido, cobrado,
deuda) y listado para el super_admin. Verificado contra la API el 11/09. Los
datos de desarrollo se reiniciaron (respaldo en `respaldos/`).

- [x] ~~Colección Marca~~ · ~~DNI en el usuario~~ · ~~Datos por marca~~ ·
      ~~Dueños~~ · ~~Estadísticas~~ · ~~Super admin~~ ✅ 11/09
- [ ] Pantallas del front: completá tu perfil, creá tu marca, mi marca
- [ ] Atrapar en el `client.ts` del front el 403 con `detalles.pendiente`

#### Etapa 6 — Métricas ⬜
Qué se vende más, quién debe más, cuánto se fía por mes.

---

## Marcas

La marca es **el negocio** dentro de la app: "BebyRo", "JuniorPres". Todo lo
del negocio —clientes, especies, productos, facturas, tickets, pagos— **es de
la marca**, no de un usuario.

Una marca puede tener **varios dueños, todos iguales**. Ella y él manejan
BebyRo: cualquiera de los dos entra con su cuenta y hace exactamente lo mismo.
Ven los mismos clientes, cargan tickets en las mismas facturas y la numeración
es una sola.

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

### Las reglas

| Regla | Qué significa |
| --- | --- |
| **Sin marca no se opera** | Todo administrador tiene que crear su marca (o que lo sumen a una) antes de usar la app |
| **Primero el DNI** | Para crear o sumarse a una marca hay que cargar el DNI |
| **Una sola marca por usuario** | No se pasa de BebyRo a JuniorPres. Puede editar la suya, no cambiarse |
| **N dueños, todos iguales** | Cualquier dueño edita la marca, sube el logo, suma o saca dueños |
| **Se suma por DNI, al instante** | Solo a alguien que ya tiene cuenta, con su DNI cargado y sin marca |
| **Nunca sin dueños** | El último dueño no puede irse ni ser borrado |
| **El que se va no se lleva nada** | Queda sin marca y vuelve a empezar; los datos quedan en la marca |
| **El DNI no se cambia** | Se carga una vez. Si está mal, lo corrige el super_admin |

---

### El onboarding: `pendiente`

Después de registrarse, al usuario le pueden faltar dos cosas, en este orden:

```
registro ──► pendiente: "perfil" ──► PUT /auth/me/perfil { dni }
                                          │
                        pendiente: "marca" ◄┘
                          │                │
              POST /marcas { nombre }     o un dueño lo suma con su DNI
                          │                │
                          └──► pendiente: null ──► usa la app
```

**`pendiente` viene en la sesión** (registro, login, Google, `GET /auth/me`),
así el front sabe qué pantalla mostrar sin preguntar dos veces:

| `pendiente` | Pantalla |
| --- | --- |
| `"perfil"` | "Completá tu perfil": pedir el DNI |
| `"marca"` | "Creá tu marca" · o "Esperá a que te sumen: pasale tu DNI a tu socio" |
| `null` | La app |

**Si igual llama a una ruta del negocio**, responde `403` con el mismo dato,
así cualquier pantalla puede mandar al onboarding:

```jsonc
// GET /clientes sin DNI
{ "error": "Completá tu perfil con tu DNI antes de empezar", "detalles": { "pendiente": "perfil" } }

// GET /clientes con DNI y sin marca
{ "error": "Creá tu marca o pedile a un dueño que te sume con tu DNI", "detalles": { "pendiente": "marca" } }
```

> En el `client.ts` del front conviene atraparlo en un solo lugar: si
> `status === 403` y viene `detalles.pendiente`, navegar a esa pantalla.

El super_admin no tiene marca ni `pendiente`: administra la app, no opera un
negocio. Si llama a una ruta del negocio recibe `403`.

---

### Los endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `PUT` | `/auth/me/perfil` | Cargar el DNI (una vez) |
| `GET` | `/auth/me` | El usuario, su marca con los dueños, y `pendiente` |
| `POST` | `/marcas` | Crear la marca propia |
| `GET` | `/marcas/mia` | La marca: datos, dueños y estadísticas |
| `PUT` | `/marcas/mia` | Editar nombre, dirección y teléfono |
| `POST` | `/marcas/mia/logo/firma` | Paso 1 del logo |
| `PUT` | `/marcas/mia/logo` | Paso 2 del logo |
| `DELETE` | `/marcas/mia/logo` | Sacar el logo |
| `POST` | `/marcas/mia/duenos` | Sumar un dueño por DNI |
| `DELETE` | `/marcas/mia/duenos/:usuarioId` | Sacar a un dueño, o irse (el propio id) |
| `GET` | `/marcas` | **super_admin:** todas las marcas con dueños y números |
| `PUT` | `/usuarios/:id/dni` | **super_admin:** corregir un DNI |

---

### PUT /auth/me/perfil

```jsonc
{ "dni": "30.111.222" }   // con o sin puntos
```

Se guarda normalizado (`"30111222"`): el mismo DNI escrito de las dos maneras
no pasa como dos personas. Tiene que tener **7 u 8 números**.

```jsonc
// 200
{ "usuario": { "_id": "…", "nombre": "Ana", "dni": "30111222", … }, "pendiente": "marca" }
```

| Caso | Status | `error` |
| --- | --- | --- |
| DNI con menos de 7 o más de 8 números | 400 | `El DNI tiene que tener 7 u 8 números` + `detalles: { campo: "dni" }` |
| Ya tenía DNI | 400 | `Tu DNI ya está cargado. Si hay que corregirlo, pedíselo al administrador de la app.` |
| Otra cuenta ya tiene ese DNI | 409 | `Ese DNI ya está registrado en otra cuenta` |

---

### POST /marcas — crear la marca

```jsonc
{
  "nombre": "BebyRo",
  "direccion": "Av. Siempreviva 742",
  "telefono": "11 4444-5555",
  "colorPrimario": "#1e3a8a",
  "colorSecundario": "#f59e0b"
}
```

| Campo | Regla |
| --- | --- |
| `nombre` | Requerido, hasta 80. Va grande en el PDF |
| `direccion` | Opcional, hasta 120 |
| `telefono` | Opcional, hasta 40 |
| `colorPrimario` | Opcional. Hex: `#1e3a8a`, `1E3A8A` o `#abc`. Se guarda `#rrggbb` en minúscula |
| `colorSecundario` | Opcional, mismo formato |

Los colores tiñen el PDF de la factura (ver
[FACTURA_PDF.md](#los-colores-de-la-marca)). Sin elegir, el PDF
sale con la paleta de la app. Conviene que el selector del front arranque con
un par ya elegido, así nadie queda con el violeta por no tocarlo.

Quien la crea queda como primer dueño. Responde `201` con la marca, igual que
`GET /marcas/mia`:

```jsonc
{
  "_id": "6aa41c2a703f7d589d40cbfe",
  "nombre": "BebyRo",
  "direccion": "Av. Siempreviva 742",
  "telefono": "11 4444-5555",
  "logoUrl": "https://res.cloudinary.com/<cloud>/image/upload/v1789…/marcas/6aa41c2a…/logo",
  "colorPrimario": "#1e3a8a",
  "colorSecundario": "#f59e0b",
  "puedeSubirLogo": true,
  "creadaPor": "6aa41c29703f7d589d40cbf3",
  "estadisticas": {
    "cantidadClientes": 2,
    "totalVendido": 11000,
    "totalCobrado": 2000,
    "deudaPendiente": 9000,
    "actualizadasEl": "2026-09-11T15:20:11.254Z"
  },
  "duenos": [
    { "_id": "6aa41c29703f7d589d40cbf3", "nombre": "Ana", "email": "ana@…", "dni": "30111222" },
    { "_id": "6aa41c29703f7d589d40cbf9", "nombre": "Beto", "email": "beto@…", "dni": "28456789" }
  ]
}
```

| Caso | Status | `error` |
| --- | --- | --- |
| Sin nombre | 400 | `La marca necesita un nombre` |
| Un campo que no es texto o muy largo | 400 | `El campo "direccion" puede tener hasta 120 caracteres` |
| Un color que no es hex | 400 | `El campo "colorPrimario" tiene que ser un color hex, como #4a1866` + `detalles: { campo }` |
| Todavía sin DNI | 403 | `Completá tu perfil con tu DNI antes de crear tu marca` + `detalles: { pendiente: "perfil" }` |
| Ya tiene marca | 409 | `Ya tenés una marca` |
| Es super_admin | 403 | `El super_admin no tiene marca…` |

### PUT /marcas/mia — editar

Mismo body que el alta. **Reemplaza los textos**: el front manda el formulario
como quedó. El nombre es obligatorio; dirección o teléfono vacíos se borran.
El logo no se toca. Lo puede hacer cualquier dueño.

**Los colores, en cambio, solo cambian si vienen**: un body sin
`colorPrimario` deja el que estaba. Para sacarlo (y volver a la paleta de la
app) se manda `null` o `""`.

---

### Los dueños

#### POST /marcas/mia/duenos — sumar

```jsonc
{ "dni": "28456789" }
```

Entra **al instante**. Responde `201` con la marca y la lista de dueños nueva.

| Caso | Status | `error` |
| --- | --- | --- |
| DNI inválido | 400 | `El DNI tiene que tener 7 u 8 números` |
| Nadie tiene ese DNI | 404 | `No hay ninguna cuenta con ese DNI. Tiene que registrarse y cargar su DNI primero` |
| Ya es dueño de esta marca | 409 | `Esa persona ya es dueña de esta marca` |
| Tiene otra marca | 409 | `Esa persona ya tiene su propia marca` |
| Es super_admin | 400 | `Esa cuenta no puede sumarse a una marca` |

> **Por eso el orden del onboarding importa:** si tu socio ya creó su propia
> marca, no lo podés sumar. Tiene que registrarse, cargar el DNI y **esperar**
> a que lo sumes, sin crear una.

#### DELETE /marcas/mia/duenos/:usuarioId — sacar, o irse

Cualquier dueño saca a otro. Con el **propio** id, se va:

```jsonc
// sacar a otro → 200, la marca con la lista nueva
// irse → 200
{ "mensaje": "Saliste de BebyRo", "marca": null, "pendiente": "marca" }
```

El que sale queda **sin marca**: vuelve a la pantalla de "creá tu marca o
esperá que te sumen". **No se lleva nada**: los clientes, tickets y pagos que
cargó quedan en la marca, con su nombre en `registradoPor`.

| Caso | Status | `error` |
| --- | --- | --- |
| Es el último dueño | 400 | `Es el único dueño: la marca no puede quedar sin dueños. Sumá a alguien antes de salir.` |
| No es dueño de esta marca | 404 | `Dueño no encontrado` |

---

### El logo

**Uno por marca, y punto.** El archivo en Cloudinary se llama siempre
`marcas/<id de la marca>/logo` y cambiarlo pisa al anterior: aunque lo suban
los dos dueños, diez veces cada uno, queda uno solo. El detalle de la subida
(firma, Cloudinary, `version`) está en
[FACTURA_PDF.md](#el-logo-uno-por-marca-y-punto); lo único que
cambió son las rutas, que ahora cuelgan de `/marcas/mia/logo`.

**`puedeSubirLogo`** viene en toda respuesta con la marca (`GET /marcas/mia`,
`/auth/me`, el alta, las del logo y las de dueños). Es `true` cuando el server
tiene Cloudinary configurado: con `false`, la app no muestra el botón de logo
(pedir la firma daría `503`). No depende de la marca ni de si ya tiene logo:
para eso está `logoUrl`.

| `puedeSubirLogo` | `logoUrl` | La pantalla muestra |
| --- | --- | --- |
| `true` | no viene | [ Subir logo ] |
| `true` | viene | El logo, [ Cambiar logo ] y "Sacar logo" |
| `false` | no viene | Nada de logo |
| `false` | viene | El logo, sin botones para cambiarlo |

---

### Las estadísticas

Lo que mueve la marca, en `estadisticas`:

| Campo | Qué es |
| --- | --- |
| `cantidadClientes` | Clientes de la marca |
| `totalVendido` | Todo lo que se llevaron: Σ total de los tickets, **sin anulados** |
| `totalCobrado` | La plata que entró: lo que dejaron al comprar + los pagos a cuenta, **sin anulados** |
| `deudaPendiente` | Lo que le deben hoy: Σ saldo de las facturas no anuladas que deben algo |
| `actualizadasEl` | Cuándo se recalcularon por última vez |

**Se guardan, pero nunca se suman a mano:** se recalculan desde cero cada vez
que se carga un cliente, un ticket o un pago, o se anula algo. Igual que los
totales de la factura, no se pueden desfasar.

```
2 clientes · Rosa: ticket $10.000 (dejó $2.000) · Luz: ticket $10.000 · pago de Rosa $3.000

totalVendido    $20.000   10.000 + 10.000
totalCobrado    $ 5.000    2.000 +  3.000
deudaPendiente  $15.000    Rosa 5.000 + Luz 10.000

anulan el ticket de Luz  →  vendido 10.000 · deuda 5.000
anulan el pago de Rosa   →  cobrado  2.000 · deuda 8.000
```

---

### El super_admin

#### GET /marcas

Todas las marcas, **paginado**, con sus dueños y estadísticas. Query:
`buscar` (en el nombre), `pagina`, `porPagina` (hasta 100).

```jsonc
{ "datos": [ /* marcas, como GET /marcas/mia */ ], "total": 12, "pagina": 1, "porPagina": 20, "paginas": 1 }
```

#### PUT /usuarios/:id/dni

```jsonc
{ "dni": "30111223" }
```

Para corregir un DNI mal cargado. Un DNI de otra cuenta responde `409`.

#### DELETE /usuarios/:id

Si el usuario es el **único dueño** de su marca, responde `400`: la marca no
puede quedar sin dueños. Primero hay que sumar a otro.

---

### Qué cambió en el resto de la app

- **Todas las rutas del negocio** (`/clientes`, `/especies`, `/productos`,
  `/facturas`, tickets, pagos, PDF) filtran por **la marca**, no por el usuario.
  Un dueño ve todo lo de la marca, lo haya cargado quien lo haya cargado.
- **`registradoPor`** en tickets y pagos dice **cuál de los dueños** lo cargó.
- **La numeración de facturas es por marca**: la 0001 la cierra Ana, la 0002
  Beto.
- **El PDF y el link público** salen con el nombre y el logo de la marca.
- **Las rutas `/auth/me/marca*` ya no existen**: ahora son `/marcas/mia*`.
- **`PUT /productos/:id`** solo acepta `nombre, talle, precio, stock, activo,
  especie`, y la especie tiene que ser de la marca. Antes guardaba el body
  entero y se podía pasar un producto a otra cuenta.

---

### El servicio en el front

```ts
// src/api/marcas.service.ts
import { request } from "./client";

export type Pendiente = "perfil" | "marca" | null;

export interface Dueno {
  _id: string;
  nombre: string;
  email: string;
  dni: string;
  avatar?: string;
}

export interface Marca {
  _id: string;
  nombre: string;
  direccion?: string;
  telefono?: string;
  logoUrl?: string;
  /** "#rrggbb". Sin elegir, el PDF sale con la paleta de la app. */
  colorPrimario?: string;
  colorSecundario?: string;
  creadaPor: string;
  duenos: Dueno[];
  estadisticas: {
    cantidadClientes: number;
    totalVendido: number;
    totalCobrado: number;
    deudaPendiente: number;
    actualizadasEl?: string;
  };
}

export interface DatosMarca {
  nombre: string;
  direccion?: string;
  telefono?: string;
  /** null lo saca; sin mandarlo, queda el que estaba. */
  colorPrimario?: string | null;
  colorSecundario?: string | null;
}

export const marcasService = {
  /** El DNI, una sola vez. Acepta "30.111.222". */
  completarPerfil(dni: string) {
    return request<{ usuario: unknown; pendiente: Pendiente }>("/auth/me/perfil", {
      method: "PUT",
      body: { dni },
    });
  },

  crear(datos: DatosMarca) {
    return request<Marca>("/marcas", { method: "POST", body: datos });
  },

  mia() {
    return request<Marca>("/marcas/mia");
  },

  /** Reemplaza los textos: mandá el formulario como quedó. */
  editar(datos: DatosMarca) {
    return request<Marca>("/marcas/mia", { method: "PUT", body: datos });
  },

  sumarDueno(dni: string) {
    return request<Marca>("/marcas/mia/duenos", { method: "POST", body: { dni } });
  },

  sacarDueno(usuarioId: string) {
    return request<Marca>(`/marcas/mia/duenos/${usuarioId}`, { method: "DELETE" });
  },

  /** Irse de la marca: queda sin marca y vuelve al onboarding. */
  irme(miId: string) {
    return request<{ mensaje: string; marca: null; pendiente: "marca" }>(
      `/marcas/mia/duenos/${miId}`,
      { method: "DELETE" }
    );
  },
};

/** A qué pantalla va, según la sesión. */
export function pantallaInicial(pendiente: Pendiente): "perfil" | "marca" | "app" {
  return pendiente ?? "app";
}
```

---

### Las pantallas

#### Completá tu perfil

```
┌────────────────────────────────────────────┐
│  Completá tu perfil                        │
│  Tu DNI identifica tu cuenta: con él tu    │
│  socio te puede sumar a su marca.          │
│                                            │
│  DNI   [ 30.111.222            ]           │
│  No se puede cambiar después.              │
│                                            │
│              [ Continuar ]                 │
└────────────────────────────────────────────┘
```

#### Tu marca

```
┌────────────────────────────────────────────┐
│  ¿Cómo se llama tu negocio?                │
│                                            │
│  Nombre     [ BebyRo                ]      │
│  Dirección  [                       ]      │
│  Teléfono   [                       ]      │
│              [ Crear mi marca ]            │
│ ────────────────── o ───────────────────── │
│  ¿Tu socio ya tiene la marca creada?       │
│  Pasale tu DNI 30.111.222 para que te sume │
│  y tocá [ Ya me sumó ]                     │
└────────────────────────────────────────────┘
```

"Ya me sumó" vuelve a pedir `GET /auth/me`: si `pendiente` es `null`, entra.

#### Mi marca (configuración)

```
┌────────────────────────────────────────────┐
│  BebyRo                          [ logo ]  │
│  2 clientes · vendido $11.000              │
│  cobrado $2.000 · le deben $9.000          │
├────────────────────────────────────────────┤
│  Dueños                                    │
│   Ana   · 30111222              (vos)      │
│   Beto  · 28456789          [ Sacar ]      │
│  DNI [            ]   [ Sumar dueño ]      │
├────────────────────────────────────────────┤
│  [ Editar datos ]        [ Irme de la marca ] │
└────────────────────────────────────────────┘
```

#### Checklist

**Onboarding**
- [ ] Después de login/registro, decidir la pantalla con `pendiente`
- [ ] Un 403 con `detalles.pendiente` en cualquier request manda al onboarding
- [ ] Perfil: teclado numérico, acepta puntos, avisar que no se cambia
- [ ] Marca: crear, o mostrar el DNI propio para que el socio lo sume
- [ ] "Ya me sumó" re-consulta `/auth/me`

**Mi marca**
- [ ] Estadísticas arriba, en pesos
- [ ] Lista de dueños; el propio marcado como "vos"
- [ ] Sumar por DNI, con los mensajes del backend (404 / 409)
- [ ] "Sacar" con confirmación; no mostrarlo si es el único dueño
- [ ] "Irme" con confirmación fuerte: "no te llevás nada"
- [ ] Editar datos y logo (cualquier dueño)

**Super admin**
- [ ] Listado de marcas con dueños y números, con buscador
- [ ] Corregir DNI desde la ficha del usuario

---

### Decisiones y límites

- **Los dueños no se guardan en la marca:** salen de los usuarios que apuntan a
  ella (`usuario.marca`). Una sola fuente de verdad, sin listas que se
  desincronicen.
- **El DNI es solo argentino** (7 u 8 números). Un documento extranjero no
  entra; se puede ampliar si hace falta.
- **Carrera rara:** si dos dueños se sacan mutuamente en el mismo instante, la
  marca podría quedar sin dueños. Con dos personas en un negocio no pasa; si
  pasara, lo resuelve el super_admin.
- **Las estadísticas se recalculan en cada cambio** sobre toda la marca. Para un
  negocio de barrio es instantáneo; con decenas de miles de tickets conviene
  pasarlas a un recálculo diferido.
- **Los datos anteriores se borraron** con `scripts/reiniciar-datos.mjs` (con
  respaldo en `respaldos/`): antes todo era de un usuario y no había forma
  limpia de repartirlo en marcas.

---

### Probarlo por consola

```bash
TOKEN=...   # POST /auth/login

curl -X PUT http://localhost:4000/auth/me/perfil \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dni":"30.111.222"}'

curl -X POST http://localhost:4000/marcas \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"nombre":"BebyRo"}'

curl -X POST http://localhost:4000/marcas/mia/duenos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dni":"28456789"}'

curl http://localhost:4000/marcas/mia -H "Authorization: Bearer $TOKEN"
```

---

## Sección Clientes

Todo lo necesario para armar la pantalla de clientes. Autocontenido: no hace
falta leer otro documento salvo el cliente HTTP.

- **Base:** `http://localhost:4000`
- **Auth:** todos los endpoints piden `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

> **No hay borrado de clientes.** Es a propósito: borrar un cliente se lleva su
> historial de compras y las métricas de ese período. Cuando haga falta sacarlo
> de la lista, va a ser una baja lógica.

---

### Qué es un cliente

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

### Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/clientes` | Listado con búsqueda, filtros y paginación |
| `GET` | `/clientes/:id` | Detalle, con deuda y factura abierta |
| `POST` | `/clientes` | Alta |
| `PUT` | `/clientes/:id` | Edición parcial |

---

### GET /clientes

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

### GET /clientes/:id

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

### POST /clientes

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

### PUT /clientes/:id

**Parcial**: mandá solo lo que cambió. Lo que no mandes queda como está.

```jsonc
{ "limiteCredito": 80000 }
```

Mismas validaciones y errores que el alta. Responde `200` con el cliente.

> Cambiar la ventana de pago afecta a las facturas que se abran **de ahí en
> más**. La que está abierta hoy mantiene su vencimiento.

---

### El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend), que ya
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

#### Listado con buscador

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

#### Alta, mostrando los errores donde corresponde

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

### Checklist de la pantalla

#### Listado
- [ ] Nombre, DNI, teléfono y deuda por fila
- [ ] Buscador con debounce de ~300 ms
- [ ] Chips de filtro: "Solo deudores", "Solo vencidos"
- [ ] Scroll infinito o paginador con `pagina` / `paginas`
- [ ] Destacar `deuda > 0`
- [ ] En rojo los de `facturasVencidas > 0`
- [ ] Alertar si `limiteCredito > 0 && deuda > limiteCredito`
- [ ] Estado vacío distinto para "no hay clientes" y "la búsqueda no encontró nada"
- [ ] Botón de alta

#### Alta y edición
- [ ] Nombre y DNI obligatorios, validados antes de enviar
- [ ] Selector de ventana de pago con 1–10 por defecto
- [ ] Impedir `desdeDia > hastaDia` desde el propio control
- [ ] Errores de `detalles` bajo cada campo
- [ ] El 409 va bajo el campo DNI
- [ ] En edición, precargar y mandar solo lo que cambió
- [ ] Avisar que cambiar la ventana no mueve el vencimiento de la factura actual

#### Detalle
- [ ] Deuda total arriba de todo
- [ ] Tarjeta de la factura abierta con saldo, `venceEl` y `diasParaVencer`
- [ ] Usar `estadoVisible` para el chip de estado
- [ ] Accesos a: editar, cargar ticket, registrar pago

---

## Sección Especies

Todo lo necesario para armar la pantalla de especies. Autocontenido: no hace
falta leer otro documento salvo el cliente HTTP.

- **Base:** `http://localhost:4000`
- **Auth:** todos los endpoints piden `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

> **Reemplaza a `/catalogos`.** El endpoint viejo ya no existe: la colección se
> llama `especies` y la ruta es `/especies`. Los datos que había se migraron
> con los mismos `_id` (ver [scripts/migrar-especies.mjs](../scripts/migrar-especies.mjs)).

---

### Qué es una especie

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

#### Para qué sirve entonces

Para que el nombre escrito a mano no se pierda como texto suelto. La especie
viaja **copiada dentro del ítem del ticket** (`especie` + `especieNombre`), y de
ahí salen las métricas de la etapa 7: qué se vende más, sin importar que un día
se haya escrito "Pantalón largo" y otro "Pantalon de vestir".

Por eso la lista tiene que quedar **corta**: son categorías, no productos. Si el
administrador termina con 60 especies, el objetivo se perdió.

### No se borran las que están en uso

Una especie que aparece en algún ticket **no se puede borrar**: se desactiva
(`activo: false`). Si se borrara, el historial quedaría hablando de un tipo de
mercadería que ya no existe y las métricas de ese período se irían con ella.

El backend te frena solo, con un `400` que dice cuántos tickets la nombran. En
el front eso se traduce en: **el botón de borrar ofrece desactivar cuando falla**.

---

### Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/especies` | Todas las del negocio |
| `POST` | `/especies` | Alta |
| `PUT` | `/especies/:id` | Edición parcial, y activar/desactivar |
| `DELETE` | `/especies/:id` | Borrado real, solo si no la usa nadie |

No hay `GET /especies/:id`: la lista es corta y viene entera, así que el detalle
sale de lo que ya tenés en memoria.

---

### GET /especies

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

### POST /especies

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

### PUT /especies/:id

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

### DELETE /especies/:id

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

### Cómo se usa en el ticket

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

### El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend), que ya
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

#### Alta, con el 409 en su campo

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

#### Borrar, con la salida por desactivar

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

#### En el formulario del ticket

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

### Checklist de la pantalla

#### Listado
- [ ] Una fila por especie: nombre, descripción y estado
- [ ] Ordenar con `localeCompare`, no confiar en el orden de la API
- [ ] Inactivas visibles pero en gris, o detrás de un toggle "ver inactivas"
- [ ] Interruptor de activa/inactiva en la fila, sin entrar a editar
- [ ] **Estado vacío que empuje a crear la primera**: es lo primero que ve un
      negocio recién dado de alta, y sin especies no se puede cargar un ticket
- [ ] Sugerir nombres al arrancar (Pantalón, Pantalón corto, Remera, Zapatilla,
      Media, Campera) para que la lista inicial sea un par de clicks
- [ ] Avisar si la lista se hace larga: son categorías, no productos

#### Alta y edición
- [ ] Un modal alcanza: son dos campos
- [ ] `nombre` obligatorio, validado antes de enviar
- [ ] El 409 va bajo el campo nombre
- [ ] En edición, precargar y mandar solo lo que cambió
- [ ] Para limpiar la descripción mandar `""`, no `null`

#### Borrado
- [ ] Confirmación antes del DELETE
- [ ] Al 400, ofrecer desactivar en vez de mostrar el error suelto
- [ ] Usar el `error` del backend tal cual: ya viene con el número

#### Integración con el ticket
- [ ] El selector de cada renglón usa solo las activas
- [ ] Si no hay ninguna, acceso a esta pantalla en vez de un select vacío
- [ ] Poder crear una especie sin salir del ticket (son dos campos)

---

## El ticket — CRUD completo

La pantalla más importante de la app: el administrador tiene al cliente
enfrente y anota lo que se lleva. Acá está **el ciclo completo del ticket**:
crearlo, leerlo, corregirlo y anularlo.

Los pagos a cuenta y el cierre de la factura van en otra guía; para ver la
factura con sus tickets, [FACTURAS.md](#vista-de-facturación).

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

### Qué es un ticket

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

### Los 4 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `POST` | `/clientes/:id/tickets` | Cargar la compra |
| `GET` | `/tickets/:id` | Leer uno |
| `PUT` | `/tickets/:id` | Corregirlo |
| `DELETE` | `/tickets/:id` | Anularlo (**baja lógica**) |

**Editar y anular solo se puede mientras la factura sigue abierta.** Una vez
cerrada ya tiene número y el cliente vio ese resumen: cambiarle los renglones
por atrás reescribiría algo que ya se comunicó.

### Lo único que tiene que existir antes

1. **El cliente.** Ya tiene su factura abierta: se le abrió sola al crearlo.
2. **Al menos una especie.** Ver [ESPECIES.md](#sección-especies).

**No hay que cargar productos.** El ítem se escribe acá, en el momento: nombre,
talle y precio del día. No hay inventario ni stock que mantener.

---

### POST /clientes/:id/tickets

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

#### La respuesta — `201`

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

#### Los cinco totales de la factura

Confunden si no se leen en orden. Son del **período entero**, no de este ticket:

| Campo | Qué es |
| --- | --- |
| `totalMercaderia` | Todo lo que se llevó |
| `totalPagadoEnTickets` | Lo que fue dejando en cada visita |
| `totalFiado` | La diferencia: lo que se anotó |
| `totalPagos` | Pagos a cuenta, aparte de los tickets |
| `saldo` | `totalFiado − totalPagos`. **Es el número que se muestra** |

---

### Dos cosas que sorprenden

#### 1. La factura que vuelve puede no ser la que tenías en pantalla

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

#### 2. El límite de crédito avisa, no bloquea

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

### Errores del alta

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

### GET /tickets/:id

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

### PUT /tickets/:id — corregir

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

#### El `pagado` cuando el ticket se achica

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

### DELETE /tickets/:id — anular

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

#### Qué significa "no suma" exactamente

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

### Errores de la edición y la anulación

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

### El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend).

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

#### Validar antes de enviar

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

#### Anular, con confirmación

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

#### Guardar — alta y edición comparten todo

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

### La pantalla

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

#### Checklist

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

### Probarlo por consola

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

---

## Vista de facturación

Cómo listar las facturas del negocio y abrir el detalle de una, con sus tickets
y los datos del cliente. **Solo lectura** — cerrar una factura, marcarla pagada
y registrar pagos van en otra guía.

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

### Qué es una factura acá

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

#### Los estados

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

#### El número

`numero` es el correlativo del negocio y **se asigna al cerrar, no al abrir**.
Una factura abierta no tiene número todavía: si lo tuviera, un cliente que se
dio de alta y nunca compró se llevaría uno.

En la pantalla eso significa: `N° 0012` cuando está cerrada o pagada, y algo
como "Período en curso" cuando está abierta.

> **La clave `numero` no viene en el JSON mientras la factura está abierta** —
> no llega como `null`, directamente está ausente. En el front va como
> `numero?: number` y se chequea con `if (factura.numero)`.

---

### Los 3 endpoints de lectura

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

### GET /facturas

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

### GET /facturas/:id

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
[CREATE_TICK.md](#delete-ticketsid--anular).

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

### GET /facturas/vencidas

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

### El servicio

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

#### El chip de estado

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

### La pantalla

#### Listado

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

#### Detalle

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

#### Checklist

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

### Lo que falta

Esta guía cubre solo la lectura. **Registrar, repartir y anular pagos** está en
[REGISTRO_PAGO.md](#registrar-un-pago), junto con los campos que eso le agregó a
la factura (`cantidadPagos`, `ultimoPagoEl`, `porcentajeCobrado`) y la sección
de pagos del detalle.

Siguen sin documentar:

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `POST` | `/facturas/:id/cerrar` | Cerrarla antes de que venza |
| `PUT` | `/facturas/:id/pagada` | Marcarla saldada (exige saldo en 0) |

El CRUD del ticket (crear, editar, anular) está en [CREATE_TICK.md](#el-ticket--crud-completo).

---

## Registrar un pago

El cliente pasa por el negocio y deja plata, sin llevarse nada. Esa plata se
**descuenta de lo que debe**: puede cubrir todo (pago completo) o una parte
(pago parcial). Acá está el ciclo completo: registrarlo, verlo en la factura y
anularlo si se cargó mal.

Para ver la factura con sus tickets, [FACTURAS.md](#vista-de-facturación). Para el
ticket, [CREATE_TICK.md](#el-ticket--crud-completo).

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`
- **Errores:** siempre `{ error, detalles? }`

---

### Qué es un pago

**Plata que el cliente deja a cuenta.** "Martes: vino Ana y dejó $20.000."

No hay que confundirlo con lo que deja **en el momento de comprar**, que va en
el ticket (`ticket.pagado`) y ya descuenta del faltante de ese ticket. El pago
es aparte: no trae mercadería, solo baja la deuda.

```
factura de Ana
  se llevó              $50.000     totalMercaderia
  dejó al comprar     − $ 9.000     totalPagadoEnTickets
  ───────────────────────────
  quedó anotado         $41.000     totalFiado
  pagos a cuenta      − $20.000     totalPagos       ← esto es lo que registra esta guía
  ═══════════════════════════
  SALDO                 $21.000     saldo
```

#### Completo o parcial

No hay que elegirlo: **sale del monto**. Si con lo que dejó el saldo queda en
cero es `completo`; si queda algo, `parcial`. El backend lo calcula y lo
devuelve en `tipo`.

| Debía | Dejó | Queda | `tipo` |
| --- | --- | --- | --- |
| $41.000 | $20.000 | $21.000 | `parcial` |
| $21.000 | $21.000 | $0 | `completo` |

**No se puede dejar más de lo que debe.** Si Ana debe $21.000 y deja $25.000,
es un `400`: el vuelto se da en el mostrador, no se anota como saldo a favor.

---

### Los 3 endpoints

| Método | Ruta | Para qué |
| --- | --- | --- |
| `POST` | `/clientes/:id/pagos` | "Dejó $20.000": **se reparte solo** entre lo que debe |
| `POST` | `/facturas/:id/pagos` | "Esto es para la de julio": **va a esa factura** |
| `DELETE` | `/pagos/:id` | Anular un pago cargado por error (**baja lógica**) |

#### ¿Cuál uso?

**Casi siempre el del cliente.** Es lo que pasa en el mostrador: el cliente deja
una plata y no dice a qué período va. El backend la aplica desde la factura más
vieja, que es lo que cualquiera espera.

El de factura es para cuando el cliente **sí** dice a cuál va, o cuando el
administrador está parado en la pantalla de una factura puntual y toca "Pagar
esta factura".

Los dos devuelven **exactamente la misma forma** de respuesta, así el front
tiene un solo manejo.

---

### El body — igual en los dos

```jsonc
{
  "monto": 20000,                  // requerido. Número > 0
  "metodoPago": "transferencia",   // opcional, default "efectivo"
  "nota": "le pagaron el aguinaldo" // opcional, hasta 300 caracteres
}
```

| Campo | Requerido | Regla |
| --- | --- | --- |
| `monto` | sí | Número mayor a 0. Se redondea a centavos |
| `metodoPago` | no | `efectivo` · `transferencia` · `mercadopago` · `otro`. Vacío = `efectivo` |
| `nota` | no | Texto libre, hasta 300 caracteres. Se le hace trim |

La fecha no se manda: es el momento en que se registra.

---

### POST /facturas/:id/pagos — pagar una factura

Todo el monto va a esa factura. Sirve para un pago **parcial** o **completo**:

- Tiene que ser una factura `abierta` o `cerrada`, con saldo.
- El monto no puede pasar su saldo.

#### La respuesta — `201`

Ana debía $41.000 en su factura y deja $20.000 por transferencia:

```jsonc
{
  "entrega": {
    "_id": "6aa2de6729e48d8e2cf2a54a",
    "fecha": "2026-09-10T16:44:23.941Z",
    "monto": 20000,
    "metodoPago": "transferencia",
    "nota": "le pagaron el aguinaldo",
    "saldoAnterior": 41000,         // lo que debía antes
    "saldoPosterior": 21000,        // lo que queda
    "tipo": "parcial",              // "completo" si saldoPosterior es 0
    "cantidadFacturas": 1
  },
  "pagos": [
    {
      "_id": "6aa2de6729e48d8e2cf2a54b",
      "factura": "6aa2de6729e48d8e2cf2a53b",
      "fecha": "2026-09-10T16:44:23.941Z",
      "monto": 20000,               // lo que descontó de ESTA factura
      "metodoPago": "transferencia",
      "nota": "le pagaron el aguinaldo",
      "entrega": "6aa2de6729e48d8e2cf2a54a",
      "montoEntrega": 20000,        // lo que dejó en total esa vez
      "saldoAnterior": 41000,
      "saldoPosterior": 21000,
      "tipo": "parcial",
      "anulado": false
    }
  ],
  "facturas": [
    {
      "_id": "6aa2de6729e48d8e2cf2a53b",
      "estado": "abierta",
      "estadoVisible": "abierta",
      "totalFiado": 41000,
      "totalPagos": 20000,
      "cantidadPagos": 1,
      "ultimoPagoEl": "2026-09-10T16:44:23.941Z",
      "porcentajeCobrado": 49,
      "saldo": 21000
      // ...el resto de la factura, igual que en FACTURAS.md
    }
  ],
  "deudaTotal": 21000               // lo que debe el cliente, sumando todas sus facturas
}
```

---

### POST /clientes/:id/pagos — la entrega que se reparte

El cliente deja una plata y el backend la aplica **de la factura más vieja a la
más nueva**. Si cubre una y sobra, el resto sigue con la siguiente.

```
Ana debe:  factura N° 0001 (cerrada)   $21.000   ← la más vieja, va primero
           factura en curso (abierta)  $30.000
                                       ───────
                                       $51.000

deja $40.000
   → N° 0001:     $21.000   completo   saldo $0       → pasa a PAGADA
   → en curso:    $19.000   parcial    saldo $11.000
```

Antes de repartir, **pone la cuenta al día**: si la factura abierta ya venció,
la cierra (igual que al cargar un ticket). No acepta más que la deuda total.

#### La respuesta — `201`

Misma forma que la del pago a factura. La diferencia es que `pagos` y
`facturas` traen **un elemento por cada factura que tocó la plata**:

```jsonc
{
  "entrega": {
    "_id": "6aa2de6729e48d8e2cf2a566",
    "fecha": "2026-09-10T16:44:23.997Z",
    "monto": 40000,
    "metodoPago": "efectivo",
    "saldoAnterior": 51000,         // la deuda TOTAL antes
    "saldoPosterior": 11000,        // la deuda TOTAL después
    "tipo": "parcial",
    "cantidadFacturas": 2
  },
  "pagos": [
    { "_id": "6aa2de6729e48d8e2cf2a567", "factura": "6aa2de...53b",
      "monto": 21000, "montoEntrega": 40000,
      "saldoAnterior": 21000, "saldoPosterior": 0, "tipo": "completo",
      "entrega": "6aa2de6729e48d8e2cf2a566" },
    { "_id": "6aa2de6729e48d8e2cf2a568", "factura": "6aa2de...55a",
      "monto": 19000, "montoEntrega": 40000,
      "saldoAnterior": 30000, "saldoPosterior": 11000, "tipo": "parcial",
      "entrega": "6aa2de6729e48d8e2cf2a566" }
  ],
  "facturas": [
    { "_id": "6aa2de...53b", "numero": 1, "estado": "pagada",
      "pagadaEl": "2026-09-10T16:44:24.023Z", "saldo": 0, "porcentajeCobrado": 100 },
    { "_id": "6aa2de...55a", "estado": "abierta", "saldo": 11000, "porcentajeCobrado": 63 }
  ],
  "deudaTotal": 11000
}
```

#### Qué es la "entrega"

La plata que el cliente dejó **esa vez**. Como un pago descuenta siempre de
**una** factura, una entrega que alcanza para dos se guarda como **dos pagos**
con el mismo `entrega`. Así:

- Cada factura muestra exactamente cuánto le tocó (`monto`).
- Se sabe cuánto dejó en total (`montoEntrega`).
- Se puede anular la entrega entera de una vez.

#### `entrega` — el comprobante

Es lo que conviene mostrar después de guardar: "Dejó $40.000 · debía $51.000 ·
queda $11.000".

| Campo | Qué es |
| --- | --- |
| `monto` | Lo que dejó |
| `saldoAnterior` | Lo que debía. En el de cliente es **la deuda total**; en el de factura, **el saldo de esa factura** |
| `saldoPosterior` | Lo que queda debiendo, con el mismo criterio |
| `tipo` | `completo` si `saldoPosterior` es 0, si no `parcial` |
| `cantidadFacturas` | En cuántas facturas se repartió |

---

### Qué le pasa a la factura

| Antes | Con el pago queda | Pasa a |
| --- | --- | --- |
| `abierta` | con saldo | `abierta` |
| `abierta` | en cero | **sigue `abierta`** — `estadoVisible: "sin deuda"` |
| `cerrada` | con saldo | `cerrada` |
| `cerrada` | en cero | **`pagada`**, con `pagadaEl` |

**La abierta no pasa a pagada aunque quede en cero:** es el período en curso y
le pueden seguir llegando tickets. Cuando vence (o se cierra a mano con
`POST /facturas/:id/cerrar`) y sigue en cero, **nace directamente `pagada`**, con
número y todo, en vez de quedar como `cerrada` con saldo cero para siempre.

> **Usá siempre las `facturas` que devuelve la respuesta**, no las que tenías
> en pantalla: traen el saldo y el estado ya recalculados. Y `deudaTotal` es el
> número que va en la ficha del cliente.

---

### La sección de pagos en la factura

`GET /facturas/:id` y `GET /clientes/:id/factura-actual` traen los pagos de esa
factura, **ordenados por fecha**, con todo lo que va en el renglón:

```jsonc
{
  "cliente": { /* ... */ },
  "factura": {
    "_id": "6aa2de6729e48d8e2cf2a53b",
    "numero": 1,
    "estado": "pagada",
    "estadoVisible": "pagada",
    "totalMercaderia": 50000,
    "totalPagadoEnTickets": 9000,
    "totalFiado": 41000,
    "totalPagos": 41000,
    "cantidadPagos": 2,                            // ← nuevo
    "ultimoPagoEl": "2026-09-10T16:44:23.997Z",    // ← nuevo
    "porcentajeCobrado": 100,                      // ← nuevo
    "saldo": 0,
    "cerradaEl": "2026-09-10T16:44:23.961Z",
    "pagadaEl": "2026-09-10T16:44:24.023Z"
  },
  "tickets": [ /* ... */ ],
  "pagos": [
    {
      "_id": "6aa2de6729e48d8e2cf2a54b",
      "fecha": "2026-09-10T16:44:23.941Z",
      "monto": 20000,
      "metodoPago": "transferencia",
      "nota": "le pagaron el aguinaldo",
      "saldoAnterior": 41000,
      "saldoPosterior": 21000,
      "tipo": "parcial",
      "entrega": "6aa2de6729e48d8e2cf2a54a",
      "montoEntrega": 20000,
      "registradoPor": { "_id": "6aa2de...533", "nombre": "Ricardo" },  // ← con nombre
      "anulado": false
    },
    {
      "_id": "6aa2de6729e48d8e2cf2a567",
      "fecha": "2026-09-10T16:44:23.997Z",
      "monto": 21000,
      "metodoPago": "efectivo",
      "saldoAnterior": 21000,
      "saldoPosterior": 0,
      "tipo": "completo",
      "entrega": "6aa2de6729e48d8e2cf2a566",
      "montoEntrega": 40000,                       // dejó 40.000, a esta le tocaron 21.000
      "registradoPor": { "_id": "6aa2de...533", "nombre": "Ricardo" },
      "anulado": false
    }
  ]
}
```

#### Los campos nuevos de la factura

| Campo | Qué es |
| --- | --- |
| `cantidadPagos` | Cuántos pagos recibió. **No cuenta los anulados** |
| `ultimoPagoEl` | Fecha del último pago no anulado. `null` si no tiene ninguno |
| `porcentajeCobrado` | `totalPagos / totalFiado`, de 0 a 100. Para la barra de progreso |

`cantidadPagos` y `ultimoPagoEl` se recalculan igual que el resto de los
totales: nunca se suman a mano, así que no pueden desfasarse.

#### El renglón del pago — qué mostrar

| Campo | Para qué |
| --- | --- |
| `fecha` | Cuándo lo dejó |
| `monto` | Lo que descontó de esta factura. **Es el número del renglón** |
| `metodoPago` | Efectivo, transferencia, Mercado Pago u otro |
| `tipo` | Chip `completo` / `parcial` |
| `saldoAnterior` → `saldoPosterior` | "debía $41.000 · quedó $21.000" |
| `montoEntrega` | Si es mayor que `monto`, la plata se repartió: "de una entrega de $40.000" |
| `nota` | Si hay |
| `registradoPor.nombre` | Quién lo cobró |
| `anulado`, `motivoAnulacion` | Tachado y en gris, con el motivo |

> **`saldoAnterior` y `saldoPosterior` son una foto del momento del pago.** Si
> después se le pega otro ticket a la factura abierta, el pago sigue diciendo lo
> que debía y lo que quedó **ese día** — igual que un recibo de papel. El saldo
> actual siempre está en `factura.saldo`.

**Los anulados vienen en la lista**, con `anulado: true`, pero no suman a
`totalPagos` ni a `cantidadPagos`. Igual que los tickets: se tachan, no
desaparecen.

---

### DELETE /pagos/:id — anular

**Es baja lógica.** El pago queda guardado con `anulado: true` y deja de
descontar.

```jsonc
// body opcional
{ "motivo": "eran 4000, no 40000" }
```

**Se anula la entrega entera**, no solo ese renglón. Si se tipeó $40.000 en vez
de $4.000, está mal en todas las facturas que tocó esa plata. Se puede mandar el
`_id` de cualquiera de los pagos de la entrega.

```jsonc
// 200
{
  "mensaje": "Pago anulado en 2 facturas",   // o "Pago anulado" si fue a una sola
  "pagos": [
    { "_id": "...567", "monto": 21000, "anulado": true,
      "anuladoEl": "2026-09-10T16:44:24.055Z", "motivoAnulacion": "eran 4000, no 40000" },
    { "_id": "...568", "monto": 19000, "anulado": true,
      "anuladoEl": "2026-09-10T16:44:24.055Z", "motivoAnulacion": "eran 4000, no 40000" }
  ],
  "facturas": [
    { "_id": "...53b", "estado": "cerrada", "saldo": 21000 },  // ← estaba pagada, vuelve a deber
    { "_id": "...55a", "estado": "abierta", "saldo": 30000 }
  ],
  "deudaTotal": 51000
}
```

**Una factura `pagada` gracias a ese pago vuelve a `cerrada`**, y pierde su
`pagadaEl`: vuelve a deber.

A diferencia del ticket, **el pago se puede anular aunque la factura esté
cerrada o pagada**. Un monto mal tipeado tiene que poder corregirse siempre; lo
único que no se puede es tocar una factura `anulada`.

> **No hay "desanular".** Si se anuló por error, se registra el pago de nuevo.

---

### Errores

Verificados uno por uno contra la API.

| Caso | Status | `error` |
| --- | --- | --- |
| `monto` ausente, 0, negativo o no numérico | 400 | `El monto del pago tiene que ser mayor a 0` |
| `metodoPago` que no existe | 400 | `Método de pago inválido. Los válidos son: efectivo, transferencia, mercadopago, otro` + `detalles: { metodoPago, validos }` |
| `nota` de más de 300 caracteres | 400 | `La nota puede tener hasta 300 caracteres` |
| **Cliente:** no debe nada | 400 | `Ana López no debe nada` + `detalles: { deuda: 0 }` |
| **Cliente:** deja más que la deuda total | 400 | `Está dejando más de lo que debe. La deuda es de $51000` + `detalles: { deuda, monto }` |
| **Factura:** pagada o anulada | 400 | `La factura está pagada, no recibe pagos` + `detalles: { estadoFactura }` |
| **Factura:** sin saldo | 400 | `La factura no tiene saldo pendiente` + `detalles: { saldo }` |
| **Factura:** deja más que su saldo | 400 | `Está dejando más de lo que debe esta factura. El saldo es de $21000` + `detalles: { saldo, monto }` |
| **Anular:** ya estaba anulado | 400 | `El pago ya está anulado` |
| **Anular:** la factura está anulada | 400 | `No se puede anular un pago de una factura anulada` |
| Cliente, factura o pago de otro negocio o inexistente | 404 | `Cliente no encontrado` · `Factura no encontrada` · `Pago no encontrado` |
| Id mal formado | 400 | `El valor de "_id" no es válido` |
| Sin token | 401 | `Token no proporcionado` |

**Si algo no valida, no se guarda nada.** Todo se chequea antes de tocar la base.

> **Validá en el front antes de enviar.** El formulario ya conoce la deuda: si
> el monto la pasa, avisalo en el campo, mientras escribe. El mensaje del
> backend queda como red de seguridad.

---

### El modelo `Pago`

| Campo | Qué es |
| --- | --- |
| `factura` | A qué factura se descontó |
| `cliente` · `administrador` | De quién y de qué negocio |
| `fecha` | Cuándo se registró |
| `monto` | Lo que descontó de **esta** factura |
| `metodoPago` | `efectivo` · `transferencia` · `mercadopago` · `otro` |
| `nota` | Texto libre, opcional |
| `entrega` | Agrupa los pagos que salieron de la misma plata |
| `montoEntrega` | Lo que dejó en total esa vez |
| `saldoAnterior` · `saldoPosterior` | La foto del recibo: cuánto debía la factura y cuánto quedó |
| `tipo` | **Derivado, no se guarda.** `completo` / `parcial` según `saldoPosterior` |
| `registradoPor` | Quién lo cargó |
| `anulado` · `anuladoEl` · `motivoAnulacion` | La baja lógica |

> **Los pagos cargados antes de este cambio** no tienen `entrega`, `montoEntrega`
> ni los saldos: vienen con `tipo: null`. El front tiene que aguantarlo y mostrar
> el renglón sin el chip. Anularlos funciona igual (se anula solo ese).

---

### El servicio

Va sobre el `client.ts` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend).

```ts
// src/api/pagos.service.ts
import { request } from "./client";
import type { Factura } from "./facturas.service";   // ver FACTURAS.md

export const METODOS_PAGO = ["efectivo", "transferencia", "mercadopago", "otro"] as const;
export type MetodoPago = (typeof METODOS_PAGO)[number];

export const NOMBRE_METODO: Record<MetodoPago, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  mercadopago: "Mercado Pago",
  otro: "Otro",
};

export interface PagoNuevo {
  monto: number;
  metodoPago?: MetodoPago;
  nota?: string;
}

export interface Pago {
  _id: string;
  factura: string;
  fecha: string;
  /** Lo que descontó de esta factura. */
  monto: number;
  metodoPago: MetodoPago;
  nota?: string;
  entrega?: string;
  /** Lo que dejó en total. Mayor que `monto` = la plata se repartió. */
  montoEntrega?: number;
  saldoAnterior?: number;
  saldoPosterior?: number;
  /** null en los pagos cargados antes de que existiera el recibo. */
  tipo: "completo" | "parcial" | null;
  /** En el detalle de la factura viene con nombre; en las respuestas, como id. */
  registradoPor: string | { _id: string; nombre: string };
  anulado: boolean;
  anuladoEl?: string;
  motivoAnulacion?: string;
}

/** El comprobante de lo que dejó. */
export interface Entrega {
  _id: string;
  fecha: string;
  monto: number;
  metodoPago: MetodoPago;
  nota?: string;
  saldoAnterior: number;
  saldoPosterior: number;
  tipo: "completo" | "parcial";
  cantidadFacturas: number;
}

/** Misma forma para las dos puertas. */
export interface RespuestaPago {
  entrega: Entrega;
  pagos: Pago[];
  /** Las facturas que tocó, ya recalculadas. */
  facturas: Factura[];
  /** Lo que debe el cliente ahora, sumando todas sus facturas. */
  deudaTotal: number;
}

export interface RespuestaAnulacionPago {
  mensaje: string;
  pagos: Pago[];
  facturas: Factura[];
  deudaTotal: number;
}

export const pagosService = {
  /** "Dejó $X": se reparte desde la factura más vieja. */
  delCliente(clienteId: string, pago: PagoNuevo) {
    return request<RespuestaPago>(`/clientes/${clienteId}/pagos`, { method: "POST", body: pago });
  },

  /** Todo a una factura puntual. */
  aFactura(facturaId: string, pago: PagoNuevo) {
    return request<RespuestaPago>(`/facturas/${facturaId}/pagos`, { method: "POST", body: pago });
  },

  /** Baja lógica de la entrega entera. */
  anular(pagoId: string, motivo?: string) {
    return request<RespuestaAnulacionPago>(`/pagos/${pagoId}`, {
      method: "DELETE",
      body: motivo ? { motivo } : undefined,
    });
  },
};

/** "debía $41.000 · quedó $21.000", o nada si es un pago viejo sin recibo. */
export function textoRecibo(p: Pago, pesos: (n: number) => string): string | null {
  if (p.saldoAnterior === undefined || p.saldoPosterior === undefined) return null;
  return `debía ${pesos(p.saldoAnterior)} · quedó ${pesos(p.saldoPosterior)}`;
}

/** Si la plata de este pago se repartió entre varias facturas. */
export const fueRepartido = (p: Pago): boolean =>
  p.montoEntrega !== undefined && p.montoEntrega > p.monto;
```

#### Validar antes de enviar

```ts
export function validarPago(monto: number, deuda: number): string | null {
  if (!(monto > 0)) return "Poné cuánto deja";
  if (deuda <= 0) return "No debe nada";
  if (monto > deuda) return `Debe ${pesos(deuda)}, no puede dejar más`;
  return null;
}
```

Para el pago del cliente `deuda` es la de la ficha (`GET /clientes/:id` →
`deuda`); para el de factura, `factura.saldo`.

#### Guardar

```ts
async function guardar() {
  const error = validarPago(monto, deuda);
  if (error) return setErrorMonto(error);

  setGuardando(true);                        // dos toques = dos pagos
  try {
    const { entrega, facturas, deudaTotal } = facturaId
      ? await pagosService.aFactura(facturaId, { monto, metodoPago, nota })
      : await pagosService.delCliente(clienteId, { monto, metodoPago, nota });

    actualizarFacturas(facturas);            // ya vienen recalculadas
    setDeuda(deudaTotal);
    mostrarComprobante(entrega);             // "Dejó $40.000 · queda $11.000"
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    setErrorGeneral(e.message);              // ya viene redactado
  } finally {
    setGuardando(false);
  }
}
```

---

### La pantalla

#### Registrar el pago

Se abre desde la ficha del cliente ("Registrar pago") o desde una factura
("Pagar esta factura"). Es el mismo formulario; lo único que cambia es a qué
endpoint va.

```
┌────────────────────────────────────────────────┐
│  Pago de Ana López                             │
│  Debe $51.000 · 2 facturas                     │
├────────────────────────────────────────────────┤
│  Deja          [     40000 ]   [ Todo ]        │
│                                                │
│  ( Efectivo ) ( Transferencia ) ( Mercado Pago )│
│  ( Otro )                                      │
│                                                │
│  Nota          [                           ]   │
├────────────────────────────────────────────────┤
│  Se aplica a                                   │
│    N° 0001  vencida       $21.000  → salda     │
│    En curso               $19.000  → queda 11.000
│  ──────────────────────────────────────────    │
│  Queda debiendo                    $11.000     │
├────────────────────────────────────────────────┤
│           [ Cancelar ]  [ Registrar pago ]     │
└────────────────────────────────────────────────┘
```

La vista previa de "Se aplica a" se arma en el front con las facturas del
cliente (`GET /clientes/:id/facturas`, las que tienen `saldo > 0`, ordenadas por
`venceEl`): es el mismo reparto que hace el backend.

#### La sección de pagos en el detalle de la factura

Va **debajo de los tickets y arriba de los totales**:

```
├──────────────────────────────────────────────────────────┤
│  PAGOS                                   2 · 100% cobrado │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │
│                                                          │
│  10/09  Transferencia   ● parcial              $20.000   │
│         debía $41.000 · quedó $21.000                    │
│         "le pagaron el aguinaldo" · cobró Ricardo        │
│                                                          │
│  10/09  Efectivo        ● completo             $21.000   │
│         debía $21.000 · quedó $0                         │
│         de una entrega de $40.000 · cobró Ricardo        │
│                                                          │
│  ̶0̶9̶/̶0̶9̶  ̶E̶f̶e̶c̶t̶i̶v̶o̶                               ̶$̶4̶0̶.̶0̶0̶0̶   │
│         anulado: "eran 4000, no 40000"                   │
├──────────────────────────────────────────────────────────┤
│  Mercadería                                     $50.000  │
│  Dejó en el momento                           − $ 9.000  │
│  Pagos a cuenta                               − $41.000  │
│  ══════════════════════════════════════════════════════  │
│  SALDO                                          $     0  │
├──────────────────────────────────────────────────────────┤
│         [ Cargar ticket ]   [ Pagar esta factura ]       │
└──────────────────────────────────────────────────────────┘
```

#### Checklist

**El formulario**
- [ ] Deuda a la vista arriba: la del cliente, o el saldo de la factura
- [ ] Teclado numérico en el monto, con el foco puesto ahí
- [ ] Botón "Todo" que iguala el monto a la deuda (el pago completo en un toque)
- [ ] Método como chips, con `efectivo` elegido de entrada
- [ ] Nota opcional, una línea alcanza
- [ ] Vista previa de a qué facturas va y cuánto queda debiendo
- [ ] Monto mayor a la deuda → error en el campo, sin enviar
- [ ] Si no debe nada, el botón "Registrar pago" no aparece

**Al guardar**
- [ ] Bloquear el botón mientras va el request (dos toques = dos pagos)
- [ ] Mostrar el comprobante con `entrega`: dejó, debía, queda, `completo`/`parcial`
- [ ] Actualizar la ficha con `deudaTotal` y las facturas con `facturas`
- [ ] Si alguna factura pasó a `pagada`, avisarlo ("Saldó la N° 0001")

**La sección de pagos en la factura**
- [ ] Un renglón por pago, ordenados por fecha (ya vienen así)
- [ ] Fecha, método, monto destacado, chip `completo`/`parcial`
- [ ] "debía $X · quedó $Y" con `saldoAnterior` / `saldoPosterior`
- [ ] "de una entrega de $X" si `montoEntrega > monto`
- [ ] Nota y quién lo cobró (`registradoPor.nombre`)
- [ ] Anulados tachados y en gris, con el motivo
- [ ] Pagos viejos sin recibo (`tipo: null`): el renglón sin chip ni saldos
- [ ] Cabecera con `cantidadPagos` y barra con `porcentajeCobrado`
- [ ] Estado vacío: "todavía no dejó nada este período"
- [ ] Botón "Pagar esta factura" solo si `estado` es `abierta` o `cerrada` y `saldo > 0`

**Anular**
- [ ] Confirmación con el monto a la vista
- [ ] Si `fueRepartido`, avisar que se anula la entrega entera ("se anula en 2 facturas")
- [ ] Pedir el motivo, opcional
- [ ] Actualizar facturas y deuda con la respuesta
- [ ] No hay deshacer: si se anuló por error, se registra de nuevo

---

### Decisiones y límites

**No hay saldo a favor.** Dejar más de lo que debe es un `400`. Antes el backend
lo aceptaba y la factura quedaba con saldo negativo, que después nadie sabía
cómo leer. Si en la práctica hace falta "dejar a cuenta de lo próximo", se
agrega aparte.

**Cambió el comportamiento de `POST /clientes/:id/pagos`.** Antes mandaba todo
el monto a la factura más vieja aunque le sobrara; ahora reparte. Y antes
aceptaba pagos de un cliente que no debía nada; ahora es un `400`.

**La fecha es la del registro.** No se puede cargar un pago "de ayer". Si hace
falta para pasar la libreta de papel al sistema, se agrega un `fecha` opcional.

**Sin transacciones.** La base es un MongoDB sin replica set, así que una
entrega repartida se guarda con un solo `insertMany` y después se recalculan
las facturas. Si el server se cae justo en el medio, los totales se corrigen
solos la próxima vez que se toque la factura (el recálculo sale siempre de los
pagos guardados).

**Dos cobros al mismo tiempo** sobre la misma factura podrían pasar los dos la
validación del saldo y dejarla en negativo. Con una sola persona en el
mostrador no pasa; si el negocio suma cajeros, hay que resolverlo.

---

### Probarlo por consola

```bash
TOKEN=...        # el que devuelve POST /auth/login
CLIENTE=6aa2de6729e48d8e2cf2a539
FACTURA=6aa2de6729e48d8e2cf2a53b

# parcial, a una factura puntual
curl -X POST http://localhost:4000/facturas/$FACTURA/pagos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"monto":20000,"metodoPago":"transferencia","nota":"le pagaron el aguinaldo"}'

# "dejó 40.000": se reparte desde la factura más vieja
curl -X POST http://localhost:4000/clientes/$CLIENTE/pagos \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"monto":40000}'

# la factura con su sección de pagos
curl http://localhost:4000/facturas/$FACTURA -H "Authorization: Bearer $TOKEN"

# anular (la entrega entera)
curl -X DELETE http://localhost:4000/pagos/$PAGO \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"motivo":"eran 4000, no 40000"}'
```

---

## La factura en PDF

El usuario le manda a su cliente una copia de la factura en PDF, **con su
marca**: su nombre y su logo, no los de la app. Hay tres caminos:

| Camino | Cómo le llega al cliente |
| --- | --- |
| **Compartir desde la app** | La app descarga el PDF y abre el menú de compartir del celular (WhatsApp, lo que sea) |
| **Link por WhatsApp** | Un link que el cliente abre sin loguearse; el mensaje ya viene escrito |
| **Mail** | Le llega al mail, con el PDF adjunto |

- **Base:** `http://localhost:4000`
- **Auth:** pide `Authorization: Bearer <token>`, salvo el link público
- **Errores:** siempre `{ error, detalles? }`, salvo el link público (HTML)

---

### No hace falta ningún storage

**El PDF no se sube ni se guarda en ningún lado.** Se arma en memoria cada vez
que alguien lo pide (unos 40–70 KB, en milisegundos) y se manda en la misma
respuesta:

```
App      GET /facturas/:id/pdf ──► se arma ──► vuelve el archivo ──► el celular lo comparte
Mail     POST /facturas/:id/enviar ──► se arma ──► va adjunto al mail
Link     el cliente abre el link ──► la API lo arma en ese momento ──► lo ve en el navegador
```

El link **no apunta a un archivo**: apunta a la API con un token firmado. Por
eso muestra siempre los datos del momento en que se abre: si el cliente pagó
algo después de recibirlo, el saldo ya viene descontado.

Lo único que se guarda afuera es **el logo de la marca**, en Cloudinary (ver
abajo). Es una imagen por marca, no un archivo por factura.

---

### Paso 0: la marca

**El PDF sale con la marca dueña de la factura**: su nombre (grande), su
dirección, su teléfono y su logo. La marca es obligatoria —sin ella no se
opera— y la comparten todos sus dueños. Cómo se crea, se edita y se suman
dueños está en **[MARCAS.md](#marcas)**.

La marca se busca **por la factura**, no por quién está logueado: así el link
público, que abre el cliente sin login, sale igual que el PDF que baja un dueño.

#### Los colores de la marca

La marca elige dos colores (`colorPrimario` y `colorSecundario`, al crearla o
al editarla) y el PDF sale con ellos:

| Color | Dónde va |
| --- | --- |
| Primario | Nombre de la marca, saldo grande, títulos, línea del total, rótulo "PAGADA" |
| Secundario | "SALDO A PAGAR", montos de los pagos, rótulo "VENCE EL…", barra de lo cobrado |
| Tintes del primario | Fondo y bordes del bloque del saldo, encabezado de la tabla |

- **Sin colores**, sale la paleta de la app, igual que antes.
- **Con uno solo**, el otro toma el mismo.
- **Un color muy claro se oscurece para el texto** (hasta contraste 4.5 sobre
  blanco): un amarillo sigue siendo amarillo en la barra, pero el saldo escrito
  en amarillo no se leería. La barra solo se oscurece si se pierde en el blanco.
- **"Vencida" sigue en ámbar**: es un aviso, no un color de la marca.

La cuenta está en `src/pdf/paleta.ts`.

#### El logo: uno por marca, y punto

**Cada marca tiene UN logo.** Se puede cambiar todas las veces que quieran,
pero nunca hay dos: el archivo en Cloudinary se llama siempre
`marcas/<id de la marca>/logo`, y cambiar el logo **pisa** al anterior en vez
de sumar otro. Así Cloudinary no se llena de logos viejos:

| Pasa esto | En Cloudinary queda |
| --- | --- |
| Suben el primer logo | 1 archivo |
| Lo cambian 10 veces, cualquiera de los dueños | 1 archivo (el último) |
| Suben uno y la app se cierra antes del paso 3 | 1 archivo (lo pisa la próxima subida) |
| Sacan el logo | 0 |

Además, Cloudinary lo guarda achicado a 1000×1000 como máximo: aunque suban
una foto de 12 MP, cada logo ocupa poco.

El archivo **va directo de la app a Cloudinary**, sin pasar por nuestro
server. El backend solo firma la subida (el secreto de Cloudinary nunca sale de
ahí) y después guarda la URL en la marca.

**Antes de mostrar el botón**, mirar `puedeSubirLogo` en la marca: es `true`
cuando el server tiene Cloudinary configurado (ver
[MARCAS.md](#el-logo)). Con `false`, la firma respondería `503`.

```
1. POST /marcas/mia/logo/firma                 → { urlSubida, campos }
2. POST <urlSubida>  (FormData: file + campos) → Cloudinary responde { version, … }
3. PUT  /marcas/mia/logo  { version }          → la marca
```

**Paso 1** — la firma vale una hora y fija todo: el nombre del archivo (el de
esa marca), que pise al anterior, los formatos (`png`, `jpg`, `jpeg` o
`webp`; SVG no) y el tamaño máximo. Con ella solo se puede reemplazar el logo
de esa marca:

```jsonc
{
  "urlSubida": "https://api.cloudinary.com/v1_1/<cloud>/image/upload",
  "campos": {
    "allowed_formats": "png,jpg,jpeg,webp",
    "invalidate": "true",
    "overwrite": "true",
    "public_id": "marcas/6aa3…/logo",
    "timestamp": 1789073112,
    "transformation": "c_limit,w_1000,h_1000",
    "api_key": "1234567890",
    "signature": "b1f4…"
  }
}
```

**Paso 2** — a Cloudinary se le manda un `FormData` con el archivo en `file` y
**todos los `campos` tal cual**. Si se cambia o se saca uno, la firma no
coincide y Cloudinary rechaza la subida.

**Paso 3** — solo la `version` que devolvió Cloudinary:

```jsonc
{ "version": 1789073112 }
```

El backend arma la URL él mismo (no la acepta del front) y chequea que el logo
exista de verdad en Cloudinary antes de guardarlo. La versión va en la URL
para que, al cambiar el logo, nadie siga viendo el viejo desde una caché.

**`DELETE /marcas/mia/logo`** lo saca de la marca y lo borra de Cloudinary.

#### Errores del logo

| Caso | Status | `error` |
| --- | --- | --- |
| Cloudinary sin configurar en el server | 503 | `La subida de logos no está configurada en el servidor` |
| `version` ausente o inválida | 400 | `Falta la versión del logo: es el campo "version" que devuelve Cloudinary al subirlo` |
| El logo no está en Cloudinary | 400 | `No encontramos el logo en Cloudinary. Probá subirlo de nuevo.` |
| Más de 30 firmas por hora | 429 | `Demasiados intentos…` |

---

### Los endpoints de la factura

| Método | Ruta | Para qué |
| --- | --- | --- |
| `GET` | `/facturas/:id/pdf` | El PDF de una factura puntual |
| `GET` | `/clientes/:id/factura-actual/pdf` | El PDF de la cuenta abierta del cliente |
| `POST` | `/facturas/:id/enviar` | Mandarla por mail |
| `POST` | `/facturas/:id/enlace` | Generar el link público y el mensaje de WhatsApp |
| `DELETE` | `/facturas/:id/enlace` | Dar de baja todos los links mandados de esa factura |
| `GET` | `/publico/facturas/:token` | **Sin login.** Lo que abre el cliente |

Todas las de arriba (menos la pública) solo encuentran facturas **del usuario
logueado**: una factura de otro responde `404`.

#### GET /facturas/:id/pdf · GET /clientes/:id/factura-actual/pdf

Devuelven el archivo, `application/pdf`:

```
Content-Disposition: attachment; filename="factura-0001-rosa-perez.pdf"
Cache-Control: private, no-store
```

| Factura | Nombre del archivo |
| --- | --- |
| Cerrada o pagada | `factura-0012-ana-lopez.pdf` |
| Abierta | `factura-en-curso-ana-lopez-2026-09-10.pdf` |

Con `?inline=1` vuelve `inline` en vez de `attachment`: el navegador lo muestra
en vez de descargarlo. Sirve para una vista previa en la web.

`factura-actual/pdf` pone la cuenta al día igual que `factura-actual`: si la
abierta venció, la cierra y el PDF sale de la abierta nueva. Para mandar una
factura puntual (la que se acaba de cerrar) usá `/facturas/:id/pdf`.

**Lo anulado no aparece.** Los tickets y pagos anulados se ven tachados en la
app, pero al cliente no se le mandan.

#### POST /facturas/:id/enviar

```jsonc
{
  "email": "rosa@mail.com",          // opcional: si no va, usa el del cliente
  "mensaje": "Cualquier cosa avisame" // opcional, hasta 500 caracteres
}
```

El `email` del body **no se guarda** en el cliente: para eso está
`PUT /clientes/:id`.

```jsonc
// 200
{ "enviado": true, "para": "rosa@mail.com", "asunto": "Tienda Rosa · Factura N° 0001",
  "archivo": "factura-0001-rosa-perez.pdf" }
```

El mail sale **con la marca**: su logo arriba (o su nombre, si no
tiene logo), el saldo y el vencimiento, el mensaje si lo hay, y el PDF
adjunto. **Si el cliente responde, le llega al usuario**, no a la app: el mail
va con `Reply-To` al email de la cuenta.

| Caso | Status | `error` |
| --- | --- | --- |
| El cliente no tiene email y no vino uno | 400 | `Este cliente no tiene email cargado. Cargáselo o escribí uno para mandarlo.` + `detalles: { campo: "email" }` |
| Email mal escrito | 400 | `El email no tiene un formato válido` |
| Mensaje de más de 500 | 400 | `El mensaje puede tener hasta 500 caracteres` |
| Factura anulada | 400 | `No se puede enviar una factura anulada` |
| El server no tiene mail configurado | 503 | `El envío de mails no está configurado en el servidor` |
| Falló el envío | 502 | `No se pudo enviar el mail. Probá de nuevo o compartila por WhatsApp.` + `detalles: { motivo }` |
| Más de 20 por hora | 429 | `Demasiados intentos…` |

#### POST /facturas/:id/enlace

```jsonc
{ "diasValidez": 7 }   // opcional, entero de 1 a 30. Default 7
```

```jsonc
// 200 — respuesta real
{
  "url": "http://localhost:4000/publico/facturas/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ2Ijow…",
  "venceEl": "2026-09-17T20:45:12.000Z",
  "diasValidez": 7,
  "textoWhatsApp": "Hola Rosa! Te paso el detalle de tu cuenta en Tienda Rosa (Período en curso): debés $ 28.000, vence el 10/09/2026.\nLo podés ver acá: http://localhost:4000/publico/facturas/eyJ…\nEl link vale hasta el 17/09/2026.",
  "urlWhatsApp": "https://wa.me/5491122334455?text=Hola%20Rosa!%20Te%20paso…",
  "telefonoWhatsApp": "5491122334455"
}
```

**Para mandarlo alcanza con abrir `urlWhatsApp`**: abre WhatsApp con el chat
del cliente y el mensaje escrito; el usuario solo toca enviar.

- El teléfono se normaliza al formato de WhatsApp: `011 15 5555-1234`,
  `+54 9 11 5555-1234` y `11 5555 1234` dan todos `5491155551234`.
- **Si el cliente no tiene teléfono** (o no se entiende), no es un error:
  `telefonoWhatsApp` viene `null` y `urlWhatsApp` abre WhatsApp para elegir el
  contacto a mano.
- Si está al día, el mensaje dice "estás al día" en vez del saldo.

Se pueden generar todos los links que quieras: generar uno nuevo **no** mata
los anteriores.

| Caso | Status | `error` |
| --- | --- | --- |
| `diasValidez` fuera de 1–30 o no entero | 400 | `Los días de validez tienen que ser un número entero entre 1 y 30` |
| Factura anulada | 400 | `No se puede compartir una factura anulada` |
| Producción sin `API_PUBLIC_URL` | 503 | `Falta configurar API_PUBLIC_URL en el servidor` |

#### DELETE /facturas/:id/enlace

Da de baja **todos** los links que se mandaron de esa factura: dejan de abrir
al toque. Los que se generen después andan normal.

```jsonc
{ "mensaje": "Listo: los links que mandaste de esta factura ya no abren.", "versionEnlace": 1 }
```

#### GET /publico/facturas/:token — lo que abre el cliente

Sin login. Devuelve el PDF `inline`, así el celular lo muestra directo.

- **Datos del momento**, no de cuando se mandó.
- Si el link está roto, vencido o dado de baja, o la factura se anuló, el
  cliente ve una página simple: *"Este link ya no está disponible. Venció o el
  negocio lo dio de baja. Pedile que te mande uno nuevo."* Es la misma página
  para todos los casos, a propósito: así no se puede averiguar qué facturas
  existen probando links.
- Máximo 30 aperturas cada 15 minutos por IP.

---

### Qué va en el PDF

Diseño **"resumen de cuenta"**: primero lo que el cliente quiere saber —cuánto
debe y para cuándo—, abajo la libreta con el saldo acumulado.

```
┌────────────────────────────────────────────────────────┐
│ Tienda Rosa                                   [logo]   │  ← la marca
│ Av. Siempreviva 742 · Tel. 11 4444-5555                │
│ ┌────────────────────────────────────────────────────┐ │
│ │ Rosa Perez                         SALDO A PAGAR    │ │
│ │ DNI 28456789 · Tel. 1122334455        $ 66.500      │ │
│ │ Factura N° 0001 · cerrada el 06/09   [VENCIÓ HACE 5]│ │
│ │ ▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │ │
│ │ Pagaste $ 20.000 de los $ 86.500 anotados · 23 %    │ │
│ └────────────────────────────────────────────────────┘ │
│ MOVIMIENTOS DEL PERÍODO                                │
│ Fecha  Movimiento                  Suma   Resta  Saldo │
│ 06/09  2 × Pantalón cargo · T. 14  28.000        28.000│
│ Compra                                                 │
│ 06/09  Pago a cuenta · Efectivo          −20.000 66.500│
│ ────────────────────────────────────────────────────── │
│        Saldo a pagar               86.500 −20.000 66.500│
├────────────────────────────────────────────────────────┤
│ Generado el …    Documento no válido como factura  1/1 │
└────────────────────────────────────────────────────────┘
```

- **Encabezado:** nombre, dirección y teléfono de la marca, y su logo si tiene.
- **El bloque del saldo:** el cliente, qué factura es ("Factura N° 0012" o
  "Período en curso"), el saldo en grande, un rótulo de estado (vence, venció
  hace N días, al día, pagada) y la barra de lo que ya pagó.
- **Movimientos:** compras y pagos mezclados por fecha, con el saldo como iba
  quedando. Cada compra lista sus ítems; si dejó algo en el momento, lo dice.
- **Muchas compras:** corta en varias páginas y repite el encabezado de la tabla.
- **Pie:** fecha de generación, "Documento no válido como factura" y el número
  de página. **Sin el nombre de la app**: el PDF es del usuario.
- **Anulada:** marca de agua "ANULADA" (solo se puede ver con login).

---

### El servicio en el front (Expo)

> **El `request()` de `client.ts` no sirve para el PDF**: siempre hace
> `JSON.parse` de la respuesta. El PDF se baja directo a un archivo.

```ts
// src/api/facturaPdf.service.ts
import * as FileSystem from "expo-file-system/legacy"; // en SDKs viejos: "expo-file-system"
import * as Sharing from "expo-sharing";
import { Linking } from "react-native";
import { request, API_URL, obtenerToken } from "./client";

export interface EnlaceFactura {
  url: string;
  venceEl: string;
  diasValidez: number;
  textoWhatsApp: string;
  /** Abre WhatsApp con el mensaje escrito. */
  urlWhatsApp: string;
  /** null = el cliente no tiene un celular que se entienda. */
  telefonoWhatsApp: string | null;
}

export const facturaPdfService = {
  /** Baja el PDF y abre el menú de compartir del celular. */
  async compartir(facturaId: string) {
    const token = await obtenerToken();
    const destino = `${FileSystem.cacheDirectory}factura-${facturaId}.pdf`;

    const { status, uri } = await FileSystem.downloadAsync(
      `${API_URL}/facturas/${facturaId}/pdf`,
      destino,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (status !== 200) throw new Error("No se pudo armar el PDF");

    await Sharing.shareAsync(uri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
      dialogTitle: "Mandar la factura",
    });
  },

  /** Arma el link y abre WhatsApp con el mensaje listo. */
  async porWhatsApp(facturaId: string, diasValidez?: number) {
    const enlace = await request<EnlaceFactura>(`/facturas/${facturaId}/enlace`, {
      method: "POST",
      body: diasValidez ? { diasValidez } : {},
    });
    await Linking.openURL(enlace.urlWhatsApp);
    return enlace;
  },

  enviarPorMail(facturaId: string, datos: { email?: string; mensaje?: string } = {}) {
    return request<{ enviado: true; para: string; asunto: string; archivo: string }>(
      `/facturas/${facturaId}/enviar`,
      { method: "POST", body: datos }
    );
  },

  darDeBajaLinks(facturaId: string) {
    return request<{ mensaje: string }>(`/facturas/${facturaId}/enlace`, { method: "DELETE" });
  },
};
```

#### Subir el logo

```ts
// src/api/marca.service.ts
import * as ImagePicker from "expo-image-picker";
import { request } from "./client";

interface FirmaLogo {
  urlSubida: string;
  campos: Record<string, string | number>;
}

export async function elegirYSubirLogo() {
  const elegido = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.9,
  });
  if (elegido.canceled) return null;
  const imagen = elegido.assets[0];

  // 1. La firma
  const firma = await request<FirmaLogo>("/marcas/mia/logo/firma", { method: "POST" });

  // 2. Directo a Cloudinary: el archivo + TODOS los campos tal cual
  const form = new FormData();
  form.append("file", {
    uri: imagen.uri,
    name: imagen.fileName ?? "logo.png",
    type: imagen.mimeType ?? "image/png",
  } as unknown as Blob);
  for (const [clave, valor] of Object.entries(firma.campos)) form.append(clave, String(valor));

  const subida = await fetch(firma.urlSubida, { method: "POST", body: form }).then((r) => r.json());
  if (subida.error) throw new Error(subida.error.message);

  // 3. Guardarlo en la marca: alcanza con la versión. Devuelve la marca.
  return request<{ logoUrl?: string; puedeSubirLogo: boolean }>("/marcas/mia/logo", {
    method: "PUT",
    body: { version: subida.version },
  });
}
```

---

### Las pantallas

#### Mi marca

```
┌────────────────────────────────────────────┐
│  Mi marca                                  │
│  Así te ven tus clientes en la factura.    │
├────────────────────────────────────────────┤
│         ┌──────────┐                       │
│         │  [logo]  │   [ Cambiar logo ]    │
│         └──────────┘   Sacar logo          │
│  Nombre     [ Tienda Rosa              ]   │
│  Dirección  [ Av. Siempreviva 742      ]   │
│  Teléfono   [ 11 4444-5555             ]   │
├────────────────────────────────────────────┤
│              [ Guardar ]                   │
└────────────────────────────────────────────┘
```

#### En la factura

```
┌────────────────────────────────────────────┐
│  Factura N° 0001 · Rosa Perez    $ 66.500  │
│  …                                         │
│  [ Compartir PDF ]  [ WhatsApp ]  [ Mail ] │
└────────────────────────────────────────────┘
```

#### Checklist

**Marca**
- [ ] Ofrecerla al registrarse, con "Más tarde"
- [ ] Vista previa del logo antes de guardar
- [ ] Mostrar el progreso mientras sube a Cloudinary
- [ ] Solo png/jpg/webp: filtrarlo en el selector
- [ ] Mostrar el botón de logo solo si la marca trae `puedeSubirLogo: true`

**Factura**
- [ ] "Compartir PDF": bajar y abrir el menú de compartir
- [ ] "WhatsApp": generar el link y abrir `urlWhatsApp`
- [ ] Si `telefonoWhatsApp` es `null`, avisar que va a tener que elegir el contacto
- [ ] "Mail": si el cliente no tiene email, pedir uno en el momento
- [ ] Campo opcional de mensaje para el mail
- [ ] Bloquear los botones mientras va el request
- [ ] "Dar de baja links" en un menú secundario, con confirmación
- [ ] No mostrar las acciones en una factura anulada

---

### Variables de entorno

| Variable | Para qué |
| --- | --- |
| `API_PUBLIC_URL` | URL pública **de la API**, base del link que abre el cliente. Con Expo en un celular en desarrollo: la IP de la máquina en la red (`http://192.168.0.10:4000`). En producción es obligatoria |
| `ENLACES_SECRET` | Opcional. Clave de los links; sin ella se deriva de `JWT_SECRET`. Cambiarla invalida todos los links |
| `CLOUDINARY_URL` | `cloudinary://<api_key>:<api_secret>@<cloud_name>`. O las tres sueltas: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. Sin ellas, subir logo da 503 y el PDF sale sin logo |

---

### Decisiones y límites

- **Nada se guarda:** ni PDFs ni copias. Cada pedido arma uno nuevo con los datos al día.
- **El logo se trae de Cloudinary en PNG** (Cloudinary lo convierte, sea cual sea
  el formato con que se subió) y queda en memoria. Si Cloudinary no responde,
  el PDF sale igual, sin logo.
- **Los colores del PDF son fijos** (la paleta violeta). Solo el nombre y el
  logo son de cada marca. Si hace falta, se puede sumar un color de marca.
- **Los mails de la cuenta** (bienvenida, contraseña) siguen como estaban. Solo
  el mail de la factura sale con la marca.
- **El link lleva un token largo** (~220 caracteres): en WhatsApp se ve como un
  link más. En el log del server se guarda cortado.
- **Rate limit por IP, en memoria.** Detrás de un proxy, todos los pedidos
  comparten IP y contador hasta que se configure `trust proxy`.
- **No es un comprobante fiscal:** el pie lo dice.

---

### Probarlo por consola

```bash
TOKEN=...        # el que devuelve POST /auth/login
FACTURA=6a9d8e19759da15f312a2dd7
CLIENTE=6a9d8e19759da15f312a2dd5

# la marca
curl -X PUT http://localhost:4000/marcas/mia \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"nombre":"Tienda Rosa","direccion":"Av. Siempreviva 742","telefono":"11 4444-5555"}'

# bajar el PDF
curl http://localhost:4000/facturas/$FACTURA/pdf -H "Authorization: Bearer $TOKEN" -o factura.pdf
curl http://localhost:4000/clientes/$CLIENTE/factura-actual/pdf -H "Authorization: Bearer $TOKEN" -o actual.pdf

# el link y el mensaje de WhatsApp
curl -X POST http://localhost:4000/facturas/$FACTURA/enlace \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'

# por mail
curl -X POST http://localhost:4000/facturas/$FACTURA/enviar \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"email":"rosa@mail.com","mensaje":"Cualquier cosa avisame"}'
```

---

## Guía de integración con el frontend

Cómo consumir esta API desde el front. Está pensada para las tres vistas que ya
existen — **login**, **registro** y **recuperar contraseña** — más el manejo de
sesión que las tres comparten.

El código de ejemplo es TypeScript con `fetch`, sin dependencias ni framework:
funciona igual en React, Vue o Svelte. Lo único que cambia según el framework es
dónde guardás el estado del usuario.

---

### 1. Configuración

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

### 2. Forma de las respuestas

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

#### Códigos que vas a recibir

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

### 3. El cliente HTTP

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

### 4. El servicio de autenticación

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

### 5. Las tres vistas

#### Login

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

#### Registro

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

#### Recuperar contraseña

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

### 6. Sesión

#### Al arrancar la app

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

#### Cuándo se cae la sesión

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

### 7. Referencia de endpoints

🔒 = requiere header `Authorization: Bearer <token>`

#### Autenticación

| Método | Ruta | Body | Respuesta |
| --- | --- | --- | --- |
| POST | `/auth/registro` | `{ nombre, email, password }` | 201 `{ token, usuario }` |
| POST | `/auth/login` | `{ email, password }` | `{ token, usuario }` |
| GET | `/auth/me` 🔒 | — | `{ usuario }` |
| POST | `/auth/recuperar-password` | `{ email }` | `{ mensaje }` |
| GET | `/auth/recuperar-password/:token` | — | `{ valido, email }` |
| POST | `/auth/resetear-password` | `{ token, password }` | `{ token, usuario }` |
| POST | `/auth/cambiar-password` 🔒 | `{ passwordActual, passwordNueva }` | `{ token, usuario }` |

#### Resto de la API (todo 🔒)

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

### 8. Probar sin configurar el mail

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

---

## Login con Google

Cómo queda armado el login con Google entre este backend y la app de
React Native + Expo.

El backend **ya está implementado y probado**. Lo que falta es la configuración
en Google Cloud y el lado del front, que es lo que documenta esta guía.

---

### 1. Cómo funciona

```
   App (Expo)                    Google                     Backend
       │                            │                          │
       │ 1. "Continuar con Google"  │                          │
       ├───────────────────────────►│                          │
       │                            │                          │
       │ 2. ID token (JWT firmado)  │                          │
       │◄───────────────────────────┤                          │
       │                                                       │
       │ 3. POST /auth/google { idToken }                      │
       ├──────────────────────────────────────────────────────►│
       │                                                       │
       │                          4. verifica la firma del token
       │                             contra las claves públicas de Google
       │                          5. busca / vincula / crea la cuenta
       │                                                       │
       │ 6. { token, usuario, caso }                           │
       │◄──────────────────────────────────────────────────────┤
       │                                                       │
       │ 7. guarda el token y sigue como cualquier sesión      │
```

Lo importante del paso 4: **el front manda únicamente el ID token**. El email,
el nombre y la foto los saca el backend del token ya verificado, nunca del body.
Si confiáramos en un email mandado suelto, cualquiera podría entrar como
cualquiera con un `curl`.

Del paso 6 en adelante no hay nada nuevo: el `token` que devuelve es el mismo
JWT de siempre y se usa igual que el del login con contraseña. Todo lo de
[README-FRONTEND.md](#guía-de-integración-con-el-frontend) aplica sin cambios.

---

### 2. Google Cloud Console

Andá a **console.cloud.google.com** → tu proyecto → *APIs y servicios* →
*Credenciales*.

> ### ⚠ Antes de crear nada: cambiá el bundle ID
>
> Hoy `app.json` tiene el placeholder que pone Expo:
>
> ```json
> "ios":     { "bundleIdentifier": "com.anonymous.FACTURACIONFRONT" },
> "android": { "package":          "com.anonymous.FACTURACIONFRONT" }
> ```
>
> Los client ID de iOS y Android quedan **atados a ese identificador** y no se
> puede editar después: hay que borrarlos y crearlos de nuevo. Poné el
> definitivo (`io.useteam.morgana`, o el que sea) **antes** de este paso.

Hacen falta **tres client ID**, uno por plataforma:

| Tipo | Para qué | Qué te pide |
| --- | --- | --- |
| **Web** | Firmar el ID token. Lo necesitan también iOS y Android. | Nada especial |
| **iOS** | El login nativo en iPhone | El *bundle identifier* |
| **Android** | El login nativo en Android | El *package name* + **SHA-1** del certificado de firma |

#### El SHA-1 de Android

Es el que más problemas da: **hay uno distinto por cada forma de compilar**, y
todos tienen que estar cargados en el mismo client ID de Android.

```bash
# Build de desarrollo local
keytool -list -v -keystore ~/.android/debug.keystore \
        -alias androiddebugkey -storepass android -keypass android | grep SHA1

# Builds de EAS (development, preview y production tienen keystores distintas)
eas credentials
```

Si el SHA-1 no coincide, el login falla en Android con
`DEVELOPER_ERROR` — un error que no dice nada, pero **siempre** es esto o el
package name.

---

### 3. Backend

Los client ID van en el `.env`. **Estado actual del proyecto:**

```bash
# ✅ Ya configurados
GOOGLE_CLIENT_ID_WEB=651275238622-67kh0vh32sc4rbv8dm1girtvlrl2fo24.apps.googleusercontent.com
GOOGLE_CLIENT_ID_ANDROID=651275238622-n4a78i2rtq163984o4j0oem69269j9vm.apps.googleusercontent.com

# ⛔ Falta: crear el client tipo "iOS" en Google Cloud y pegarlo acá
# GOOGLE_CLIENT_ID_IOS=
```

Los client ID **no son secretos**: viajan dentro del bundle de la app y en cada
request a Google. Lo único sensible es el *client secret*, y este backend no lo
usa — solo verifica firmas contra las claves públicas de Google, nunca
intercambia un `code` por tokens.

**Por qué los tres:** el campo `aud` del ID token es el client ID de la
plataforma desde la que se logueó el usuario. Si el backend validara contra uno
solo, los logins desde las otras dos plataformas fallarían con
*"Wrong recipient"*. El backend los acepta a todos los que estén definidos.

Al arrancar, `./run.sh` te confirma cuántos encontró:

```
✔ GOOGLE = 2 client ID (web, android)
```

Si no ponés ninguno, el resto del login sigue funcionando normal y
`/auth/google` responde **503**.

---

### 4. El endpoint

#### `POST /auth/google`

```jsonc
// Request
{ "idToken": "eyJhbGciOiJSUzI1NiIsImtpZCI6..." }
```

```jsonc
// 200 (cuenta que ya existía)  ·  201 (cuenta nueva)
{
  "token": "eyJhbGciOiJIUzI1NiIs...",     // el JWT del backend
  "usuario": {
    "_id": "6a9ae43ac1d7cce8aa02956b",
    "nombre": "Ana Gómez",
    "email": "ana@gmail.com",
    "rol": "administrador",
    "proveedor": "google",
    "avatar": "https://lh3.googleusercontent.com/...",
    "createdAt": "2026-09-04T12:00:00.000Z",
    "updatedAt": "2026-09-04T12:00:00.000Z"
  },
  "caso": "creada"
}
```

El campo `caso` te dice qué pasó, para decidir si mostrar un onboarding:

| `caso` | Status | Qué pasó |
| --- | --- | --- |
| `creada` | 201 | Primera vez. Se creó la cuenta y se mandó el mail de bienvenida. |
| `existente` | 200 | Ya se había logueado con Google antes. |
| `vinculada` | 200 | Tenía cuenta con email + contraseña y se le vinculó Google. Ahora puede entrar de las dos formas. |

#### Errores

| Status | `error` | Qué mostrar |
| --- | --- | --- |
| 400 | `El campo "idToken" es requerido` | Bug del front: no llegó el token |
| 401 | `El token de Google no es válido o venció` | "No pudimos validar tu cuenta de Google, probá de nuevo" |
| 401 | `El token de Google no es para esta aplicación...` | Bug de config: los client ID no coinciden |
| 401 | `Google no confirmó que ese email sea tuyo...` | Mostrar tal cual: tiene que entrar con contraseña |
| 429 | `Demasiados intentos...` | Mostrar tal cual |
| 503 | `El login con Google no está configurado...` | Ocultar el botón de Google |

---

### 5. El front (Expo)

#### Qué librería usar

El proyecto ya tiene carpetas `ios/` y `android/` (prebuild hecho), así que
corre con **development builds**, no con Expo Go. Con eso la opción recomendada
es:

**`@react-native-google-signin/google-signin`** — usa la hoja nativa de Google
(en Android, Credential Manager). Mejor experiencia y menos casos raros que el
flujo por navegador. Necesita módulo nativo, por eso hay que recompilar.

> La alternativa sin módulo nativo es `expo-auth-session/providers/google`, que
> funciona hasta en Expo Go. Si en algún momento vuelven a Expo Go, es el
> camino; el backend no cambia, sigue recibiendo un `idToken`.

#### Instalación

```bash
npx expo install @react-native-google-signin/google-signin
```

Agregá el plugin en `app.json` (dentro de `expo.plugins`) y recompilá.

**Para probar solo en Android** (que es lo que se puede hoy) alcanza con:

```json
"@react-native-google-signin/google-signin"
```

**Cuando exista el client ID de iOS**, hay que pasarle el `iosUrlScheme`:

```json
["@react-native-google-signin/google-signin", {
  "iosUrlScheme": "com.googleusercontent.apps.222222-yyyy"
}]
```

El `iosUrlScheme` es **el client ID de iOS dado vuelta**: si el ID es
`222222-yyyy.apps.googleusercontent.com`, el scheme es
`com.googleusercontent.apps.222222-yyyy`. Sin esto, en iPhone la hoja de Google
abre y se cierra sola sin devolver nada.

```bash
npx expo prebuild --clean
npx expo run:ios      # o run:android
```

> Un `npx expo start` no alcanza: se agregó código nativo, hay que rebuildear.

#### Variables del front

```bash
# .env del front
EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB=651275238622-67kh0vh32sc4rbv8dm1girtvlrl2fo24.apps.googleusercontent.com

# Cuando exista el client de iOS:
# EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=...
```

**Android no lleva variable**: la librería no recibe un `androidClientId`. Google
lo resuelve solo, matcheando el *package name* + el **SHA-1** de la keystore
contra el client ID de Android que creaste. Por eso en Android todo depende de
que el SHA-1 esté bien cargado.

Los client ID **no son secretos**, van en el bundle igual. El `EXPO_PUBLIC_` es
lo que los hace visibles desde el código.

#### El servicio

```ts
// src/services/auth/google.ts
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

/**
 * Se llama una vez al arrancar la app.
 *
 * `webClientId` es obligatorio aunque estemos en iOS o Android: es el que hace
 * que Google devuelva un ID token. Sin él vuelve solo un access token, que al
 * backend no le sirve.
 */
export function configurarGoogle() {
  GoogleSignin.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_WEB!,

    // Android NO se configura acá: matchea por package name + SHA-1.
    // iOS sí lo necesita, cuando exista el client ID:
    ...(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS
      ? { iosClientId: process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS }
      : {}),

    // Solo pedimos identidad: no necesitamos acceso a Drive, Calendar, etc.
    scopes: ['profile', 'email'],
    offlineAccess: false,
  });
}

/**
 * El shape de la respuesta cambió entre versiones de la librería: v13+ devuelve
 * `{ type, data: { idToken } }` y las anteriores `{ idToken }` directo.
 * Lo leemos de las dos formas para no atarnos a una versión.
 */
function extraerIdToken(respuesta: unknown): string | null {
  const r = respuesta as { idToken?: string; data?: { idToken?: string } };
  return r?.data?.idToken ?? r?.idToken ?? null;
}

export class GoogleCancelado extends Error {}

/** Abre la hoja de Google y devuelve el ID token para mandarle al backend. */
export async function obtenerIdTokenGoogle(): Promise<string> {
  // En Android verifica que haya Google Play Services; en iOS no hace nada.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  try {
    const respuesta = await GoogleSignin.signIn();
    const idToken = extraerIdToken(respuesta);

    if (!idToken) {
      // Casi siempre es que falta webClientId en configure().
      throw new Error('Google no devolvió un ID token');
    }
    return idToken;
  } catch (e) {
    if (isErrorWithCode(e) && e.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new GoogleCancelado();
    }
    throw e;
  }
}

/** Cerrar sesión en el back no cierra la de Google: hay que hacerlo acá. */
export async function cerrarSesionGoogle() {
  try {
    await GoogleSignin.signOut();
  } catch {
    // Si no había sesión de Google no es un error que importe.
  }
}
```

#### Sumarlo al servicio de auth

Sobre el `authService` de [README-FRONTEND.md](#guía-de-integración-con-el-frontend):

```ts
// src/api/auth.service.ts
import { obtenerIdTokenGoogle, cerrarSesionGoogle } from '../services/auth/google';

export type CasoGoogle = 'creada' | 'existente' | 'vinculada';

export const authService = {
  // ...lo que ya está

  /** Login con Google. Devuelve también el caso, por si querés mostrar onboarding. */
  async loginConGoogle(): Promise<{ usuario: Usuario; caso: CasoGoogle }> {
    const idToken = await obtenerIdTokenGoogle();

    const sesion = await request<Sesion & { caso: CasoGoogle }>('/auth/google', {
      method: 'POST',
      body: { idToken },
      conToken: false,
    });

    return { usuario: abrirSesion(sesion), caso: sesion.caso };
  },

  async logout() {
    await cerrarSesionGoogle();   // ← si no, la próxima vez entra solo
    clearToken();
  },
};
```

#### En la pantalla de login

```tsx
const [cargando, setCargando] = useState(false);

async function onGooglePress() {
  setCargando(true);
  try {
    const { caso } = await authService.loginConGoogle();
    router.replace(caso === 'creada' ? '/onboarding' : '/(tabs)');
  } catch (e) {
    if (e instanceof GoogleCancelado) return;   // cerró la hoja, no es un error
    setError(e instanceof ApiError ? e.message : 'No pudimos entrar con Google');
  } finally {
    setCargando(false);
  }
}
```

#### Guardar el token

El proyecto ya tiene `secureStorage` (MMKV cifrado) en
`src/services/storage/`. El token de sesión va ahí, no en el storage común:

```ts
import { secureStorageService } from '@/services/storage/storageService';

export const setToken = (t: string) => secureStorageService.setString('token', t);
export const getToken = () => secureStorageService.getString('token');
export const clearToken = () => secureStorageService.remove('token');
```

---

### 6. Qué hace el backend con las cuentas

| Situación | Resultado |
| --- | --- |
| Ya entró con Google antes | Login normal (`existente`) |
| Email nuevo | Crea la cuenta con rol `administrador` y manda el mail de bienvenida (`creada`) |
| Ya tenía cuenta con email + contraseña, **email verificado por Google** | Vincula las dos. Conserva su contraseña y puede entrar de ambas formas (`vinculada`) |
| Ya tenía cuenta, **email NO verificado por Google** | **Rechaza** con 401 |

Ese último caso es la protección importante: sin el chequeo de `email_verified`,
alguien podría crear una cuenta de Google con el email de otra persona y quedarse
con su cuenta. Está probado.

#### Cuentas de Google intentando entrar con contraseña

Una cuenta creada con Google no tiene contraseña. Si intenta el login normal, el
backend responde 401 con un mensaje accionable:

```json
{ "error": "Esta cuenta usa Google para entrar. Tocá \"Continuar con Google\"." }
```

Lo mismo en `/auth/cambiar-password`: le explica que primero tiene que ponerse
una contraseña desde *"Olvidé mi contraseña"*.

> **Nota:** hoy una cuenta de Google **sí puede** pedir recuperación de
> contraseña y ponerse una, quedando con los dos métodos. Funciona, pero el mail
> dice "Recuperá tu contraseña", que suena raro para alguien que nunca tuvo una.
> Si molesta, se resuelve con una plantilla aparte.

---

### 7. Checklist

Backend (ya hecho y probado):

- [x] `POST /auth/google` verificando el ID token contra las claves de Google
- [x] Acepta los client ID de las tres plataformas
- [x] Crea, vincula y reconoce cuentas
- [x] Bloquea la toma de cuenta con email sin verificar
- [x] Rate limit de 20 intentos cada 15 min
- [x] 503 claro si no está configurado

Para poner en marcha:

- [x] Client ID de **Web** creado y cargado en el `.env`
- [x] Client ID de **Android** creado y cargado en el `.env`
- [ ] Verificar que el client de Android se creó con el package name definitivo
- [ ] Cargar el SHA-1 de cada keystore (debug local + cada perfil de EAS)
- [ ] Crear el client ID de **iOS** y sumarlo al `.env`
- [ ] Instalar la librería, agregar el plugin y **recompilar**
- [ ] `configurarGoogle()` al arrancar la app
- [ ] `cerrarSesionGoogle()` dentro del logout

### 8. Si algo falla

| Síntoma | Causa casi segura |
| --- | --- |
| `DEVELOPER_ERROR` en Android | SHA-1 o package name que no coinciden con el client ID |
| El login abre y cierra sin hacer nada (iOS) | `iosUrlScheme` mal puesto en el plugin |
| Vuelve sin `idToken` | Falta `webClientId` en `configure()` |
| 401 *"no es para esta aplicación"* | El client ID del front no está en el `.env` del backend |
| 503 | Falta `GOOGLE_CLIENT_ID_*` en el backend |
| Anda en dev y falla en producción | El SHA-1 de la keystore de producción no está cargado |
