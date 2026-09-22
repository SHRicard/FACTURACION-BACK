# Backend de Cuenta Corriente

Backend con **TypeScript + Node.js + Express + MongoDB (Mongoose) + JWT**, para
llevar la libreta del fiado: clientes, los tickets de lo que se llevan y los
pagos con que lo van saldando. Todo es de una **marca** (el negocio), que puede
tener varios dueños, y la factura sale en PDF con el nombre, el logo y los
colores de esa marca.

## Instalación

```bash
npm install
```

## Estructura

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

### Scripts

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

### Scripts de datos

| Comando | Qué hace |
| --- | --- |
| `node scripts/sembrar-especies.mjs <email>` | Carga la lista inicial de especies en la marca de ese dueño. Es idempotente: no duplica ni pisa |

Para restaurar un respaldo de mongodump: `mongorestore --drop respaldos/<carpeta>`.

## Configuración

1. Copiá `.env.example` como `.env`
2. Completá `MONGO_URI`, `JWT_SECRET`, `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_PASSWORD`.
   Para la factura en PDF sumá `API_PUBLIC_URL` (la URL pública de esta API, de
   donde sale el link que abre el cliente) y las `CLOUDINARY_*` (el logo de cada
   marca). Las dos son opcionales en desarrollo: ver
   [doc/FACTURA_PDF.md](doc/FACTURA_PDF.md#variables-de-entorno).

### En producción

Con `NODE_ENV=production` el server revisa la configuración **antes de
escuchar** y, si algo está mal, no arranca y lista lo que falta
(`src/config/entorno.ts`). Un secreto de ejemplo no se nota al arrancar: se nota
cuando alguien pide recuperar la contraseña y el mail no sale. No arranca si:

- `JWT_SECRET` es el de ejemplo o tiene menos de 32 caracteres.
- `SUPER_ADMIN_PASSWORD` es la de ejemplo o tiene menos de 12 caracteres.
- `API_PUBLIC_URL` falta, no es `https` o apunta a `localhost`.
- Falta el SMTP (`MAIL_HOST`, `MAIL_USER` y `MAIL_PASS`).
- Falta `LEGAL_CONTACT_EMAIL`.

En desarrollo lo mismo sale como aviso y el server arranca igual. En cualquier
entorno cortan los valores mal escritos: `TRUST_PROXY` que no es un entero de 0
a 5, `APP_VERSION_MINIMA` o `APP_VERSION_ULTIMA` sin la forma `1.2.0`,
`APP_URL_TIENDA` sin `https://` y un `APP_SCHEME` inválido.

**`TRUST_PROXY`** es la cantidad exacta de proxies delante del server (Render,
Railway o Fly = 1; Cloudflare delante de otro = 2). Sin setear vale 1 en
producción y 0 en desarrollo. Nunca `true`: con `true` cualquiera falsifica
`X-Forwarded-For` y saltea el rate limit. Mal puesto, `req.ip` es la del proxy
y toda la app comparte un único contador.

**Healthcheck del hosting:** `GET /health`, sin auth. Responde 200
`{ ok: true, mongo: "conectado", apagando: false }` si Mongo está conectado, y
503 con la misma forma si no lo está o si el server se está apagando.

**Apagado:** con `SIGTERM` (lo que manda el hosting en cada deploy) el server
deja de aceptar conexiones, `/health` pasa a 503, termina las requests en curso
(hasta 10 s; después las corta) y recién ahí cierra Mongo. Así un deploy no
corta a la mitad un registro de pago.

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
**Con `npm start` el server corre `dist/`: después de cambiar código hay que
volver a compilar y reiniciar.**

Si en la base no hay ningún `super_admin`, al arrancar se crea uno con el
email/password de `.env`.

## Documentación

> **[doc/BACKLOG.md](doc/BACKLOG.md)**: el orden en que se construye la app,
> etapa por etapa, con el detalle de cada endpoint y lo que falta. **Empezá por acá.**
>
> - [doc/CLIENTES.md](doc/CLIENTES.md): sección Clientes, lista para aplicar
> - [doc/ESPECIES.md](doc/ESPECIES.md): sección Especies
> - [doc/CREATE_TICK.md](doc/CREATE_TICK.md): **el ticket** (alta, edición y anulación)
> - [doc/FACTURAS.md](doc/FACTURAS.md): **vista de facturación** (listado y detalle)
> - [doc/REGISTRO_PAGO.md](doc/REGISTRO_PAGO.md): **registrar un pago** (completo, parcial, repartido y anulado)
> - [doc/FACTURA_PDF.md](doc/FACTURA_PDF.md): **la factura en PDF** (compartir, WhatsApp, mail, logo y colores)
> - [doc/MARCAS.md](doc/MARCAS.md): **las marcas** (onboarding con DNI + marca, dueños, logo, colores y estadísticas)
> - [doc/dashboard_metricas.md](doc/dashboard_metricas.md): **el dashboard y las métricas** (Inicio, y Más → Métricas: una pantalla por métrica)
> - [doc/README-FRONTEND.md](doc/README-FRONTEND.md): cliente HTTP y servicio de auth
> - [doc/GOOGLE_AUTH.md](doc/GOOGLE_AUTH.md): login con Google en Expo
>
> ⚠ `README-FRONTEND.md` y `GOOGLE_AUTH.md` cubren solo autenticación, que no
> cambió. Las guías de secciones están al día.

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

### Qué ves en la consola

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

Con `NODE_ENV=production` la hora sale en ISO con fecha y en UTC
(`2026-09-21T20:40:30.123Z`), así el log del hosting se ordena y se busca por
día, y los emails salen enmascarados (`a***@tienda.com`): el log del hosting lo
lee más gente y queda guardado. En desarrollo siguen la hora corta y el email
entero.

### Nivel de detalle

`LOG_LEVEL` acepta `debug | info | warn | error | silent`. Por defecto es `debug`
en desarrollo e `info` con `NODE_ENV=production` (ahí las requests exitosas dejan
de loguearse y solo quedan los errores).

### Códigos de respuesta

Todos los errores tienen la misma forma:

```ts
{
  error: string,          // el mensaje, listo para mostrar
  codigo?: string,        // estable, en MAYÚSCULAS: solo cuando el front tiene que actuar distinto
  detalles?: {
    campos?: { [campo: string]: string },  // SOLO los mensajes por campo (la clave es el input)
    ...datos                               // el resto son datos para la pantalla (deuda, pendiente…)
  },
  stack?: string[]        // solo en los 5xx y solo con NODE_ENV=development
}
```

| Situación | Status | Body |
| --- | --- | --- |
| Validación de mongoose | 400 | `{ error: "Datos inválidos", detalles: { campos: { campo: "motivo" } } }` |
| Un campo del body mal (`errorDeCampo`) | 400 | `{ error, detalles: { campos: { dni: "motivo" } } }` |
| Contraseña actual equivocada (`cambiar-password`) | 400 | `{ error, codigo: "CREDENCIALES_INVALIDAS", detalles: { campos: { passwordActual } } }` |
| ObjectId mal formado | 400 | `{ error: 'El valor de "_id" no es válido' }` |
| Índice único repetido, de un campo | 409 | `{ error: "Ya existe un registro con ese email", detalles: { campos: { email: "…" } } }` |
| Índice único compuesto | 409 | `{ error }`, sin `campos`: no hay un input al que culpar |
| Token ausente/inválido/vencido | 401 | `{ error: "Token inválido" }` |
| Falta DNI o marca | 403 | `{ error, detalles: { pendiente: "perfil" \| "marca" } }` |
| Ruta inexistente | 404 | `{ error: "Ruta no encontrada: GET /x" }` |
| App más vieja que `APP_VERSION_MINIMA` | 426 | `{ error, codigo: "APP_DESACTUALIZADA", detalles: { minima, urlTienda } }` |
| Demasiados intentos | 429 | `{ error }` + header `Retry-After` en segundos |
| Bug del servidor | 500 | `{ error: "Error interno del servidor", stack: [...] }` |

El `stack` solo se manda al cliente en los 5xx y solo con
`NODE_ENV=development`, así un hosting sin `NODE_ENV` no expone rutas ni código.

**401 es solo "la sesión no sirve"**: el front cierra la sesión ante cualquier
401 de una ruta que no es pública. Por eso una contraseña mal tipeada con la
sesión abierta (`cambiar-password`) responde 400 `CREDENCIALES_INVALIDAS`, y
no 401.

**426 `APP_DESACTUALIZADA`:** la app manda su versión en el header
`X-App-Version`. Si es más vieja que `APP_VERSION_MINIMA`, cualquier ruta
responde 426 y la app muestra "actualizá" con el link a la tienda. Sin el
header, o con una versión que no se entiende, no se bloquea. Nunca se bloquean
`/`, `/health`, `/app/*`, `/legal/*`, `/publico/*` ni `/cuenta/*`.

## Roles

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
negocio responden `403` con `detalles.pendiente`. Ver [doc/MARCAS.md](doc/MARCAS.md).

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
2. Describirlo en `DESCRIPCION_ROLES`. TypeScript lo va a exigir, no se puede olvidar.
3. Proteger las rutas con `requireRol("cliente")`.

No hay que tocar el modelo ni escribir un middleware nuevo.

## La marca: logo y colores

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

Detalle completo en [doc/MARCAS.md](doc/MARCAS.md) y
[doc/FACTURA_PDF.md](doc/FACTURA_PDF.md#los-colores-de-la-marca).

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

Ambos devuelven `{ token, usuario, pendiente }`. Usá el token en el header
`Authorization: Bearer <token>` en todas las demás requests.

### 1b. Completa su perfil y crea su marca (obligatorio)

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

### 2. Super admin crea un administrador

```bash
curl -X POST http://localhost:4000/usuarios \
  -H "Authorization: Bearer TOKEN_SUPER_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Juan","email":"juan@tienda.com","password":"123456"}'
```

### 3. El administrador (logueado) crea sus especies

Los tipos de mercadería que maneja. Se cargan una vez, y son lo único que hace
falta tener antes de vender: **no se dan de alta productos**.

```bash
curl -X POST http://localhost:4000/especies \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Pantalón"}'
```

### 4. Crea un cliente con su ventana de pago (le abre la primera factura)

```bash
curl -X POST http://localhost:4000/clientes \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"nombre":"Cliente Uno","dni":"33333333","telefono":"123","limiteCredito":50000}'
```

### 5. Registra un ticket (la compra fiada)

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

### 6. Registra un pago a cuenta

```bash
curl -X POST http://localhost:4000/clientes/ID_CLIENTE/pagos \
  -H "Authorization: Bearer TOKEN_ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"monto":10000,"metodoPago":"efectivo"}'
```

Se reparte desde la factura más vieja con saldo: primero se salda lo que se debe
hace más tiempo, y si sobra sigue con la siguiente. Para pagar una factura
puntual, `POST /facturas/ID_FACTURA/pagos`. Todo el detalle en
[doc/REGISTRO_PAGO.md](doc/REGISTRO_PAGO.md).

### 7. Ver la cuenta abierta (saldo + tickets + pagos)

```bash
curl http://localhost:4000/clientes/ID_CLIENTE/factura-actual \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

### 8. Mandarle la factura en PDF, con los colores de la marca

```bash
# Descargar el PDF
curl http://localhost:4000/facturas/ID_FACTURA/pdf \
  -H "Authorization: Bearer TOKEN_ADMIN" -o factura.pdf

# O generar el link público + el mensaje de WhatsApp
curl -X POST http://localhost:4000/facturas/ID_FACTURA/enlace \
  -H "Authorization: Bearer TOKEN_ADMIN"
```

El PDF no se guarda en ningún lado: se arma en el momento con los datos al día.
Ver [doc/FACTURA_PDF.md](doc/FACTURA_PDF.md).

## Autenticación

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
| POST | `/auth/cambiar-password` 🔒 | `{ passwordActual, passwordNueva }` | `{ token, usuario }`. Contraseña actual mal: 400 `CREDENCIALES_INVALIDAS` (nunca 401). Cuenta de Google sin contraseña: 400 `CUENTA_SIN_PASSWORD` |
| PUT | `/auth/me/perfil` 🔒 | `{ dni }` | `{ usuario, pendiente }` |

**`pendiente`** vale `"perfil"` si falta el DNI, `"marca"` si falta la marca y
`null` si ya puede operar. `GET /auth/me` suma la **marca** con sus dueños. Todo
lo de la marca (crearla, sumar dueños, logo y colores) está en
[doc/MARCAS.md](doc/MARCAS.md).

### Registro

Cualquiera puede registrarse y queda con rol `administrador`. Sus datos quedan
aislados en su marca. **El `rol` nunca se toma del body**: mandar
`{"rol":"super_admin"}` no tiene efecto.

La contraseña necesita 6 caracteres como mínimo. Si el email ya existe devuelve
400 con `"Ya hay una cuenta registrada con ese email"`.

### Login

Con un email que no existe, con una cuenta de Google (que no tiene contraseña)
o con la contraseña mal, la respuesta es siempre la misma: **401
`"Email o contraseña incorrectos"`**, y tarda lo mismo (siempre pasa por
bcrypt). Si no, la respuesta o lo que tarda delatarían qué emails usan la app.
La pista de "entrá con Google" la da la pantalla del login y el mail de
recuperación.

### Recuperación de contraseña: los 3 pasos

```
1. View "olvidé mi contraseña" (en la app)
   POST /auth/recuperar-password  { email }
   → 200 siempre, exista o no el email (para no filtrar quién está registrado)
   → manda un mail con <API_PUBLIC_URL>/cuenta/nueva-password#token=xxx
     (si la cuenta es de Google, el mail lo dice y el link sirve para ponerle una)

2. Página "nueva contraseña" (al abrir el link, antes de mostrar el formulario)
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

Las plantillas están en `src/emails/plantillas/` (bienvenida, recuperar
contraseña, contraseña cambiada y la factura al cliente) y el envío en
`src/utils/email.ts`. Al arrancar, el server verifica el SMTP y avisa en consola
si las credenciales están mal.

### Rate limit

`src/middleware/rateLimit.ts` cuenta por IP, salvo donde se indica otra cosa.
Detrás de un proxy la IP del cliente solo es real con `TRUST_PROXY` bien
puesto (ver [En producción](#en-producción)).

| Ruta | Límite |
| --- | --- |
| `POST /auth/login` | 30 cada 15 min por IP y 10 cada 15 min por email |
| `POST /auth/recuperar-password` | 10 cada 15 min por IP y 3 por hora por email |
| `GET /auth/recuperar-password/:token` | 30 cada 15 min |
| `POST /auth/resetear-password` | 10 cada 15 min |
| `POST /auth/registro` | 10 por hora |
| `POST /auth/google` | 20 cada 15 min |
| `POST /auth/cambiar-password` | 5 cada 15 min por usuario (contador `reautenticacion`) |
| `POST /facturas/:id/enviar` | 20 por hora y 100 por día por marca |
| `POST /app/errores` | 20 cada 15 min |
| Firmas de logo | 30 por hora |
| `GET /publico/facturas/:token` | 30 cada 15 min |

Al superarlo devuelve 429 con el header `Retry-After`. Un login correcto limpia
solo el contador de **su email**: el de la IP sigue corriendo, así nadie se
reinicia el cupo entrando con una cuenta propia. Los contadores por email usan
el email normalizado (`Ana@x.com ` y `ana@x.com` son el mismo). Es en memoria:
con más de una instancia del server hay que moverlo a Redis.

## Errores de la app

La app reporta sus errores de pantalla y los errores JS fatales a
`POST /app/errores` (público: si viene un token válido se asocia al usuario, y
si viene uno roto se ignora). Responde 202 `{ recibido: true }`. El back no
guarda la IP, el email, el token ni el body de las requests. El mensaje, el
stack y la ruta pasan por `redactar()` (`src/utils/logger.ts`), que cambia los
emails por `[email]`, los números de 7 o más dígitos (DNI, teléfonos) por
`[numero]` y los tokens por `[token]`. Cada reporte deja una línea `warn` en el
log con la versión, la plataforma y los primeros caracteres de su **huella**
(hash de nombre + mensaje + primera línea del stack: el mismo error cae siempre
en la misma).

Se guardan en la colección **`errores_cliente`** y se borran solos a los **30
días** (índice TTL). Para consultarlos desde `mongosh`:

```js
// Los últimos 20
db.errores_cliente.find().sort({ createdAt: -1 }).limit(20)

// Agrupados por huella: cuáles pasan más
db.errores_cliente.aggregate([
  { $group: { _id: '$huella', veces: { $sum: 1 }, mensaje: { $first: '$mensaje' }, ultima: { $max: '$createdAt' } } },
  { $sort: { veces: -1 } }
])
```

## Endpoints completos

```
GET    /health                            (healthcheck del hosting: 503 si Mongo no está o se está apagando)
GET    /app/version                       (versión mínima y última de la app, y el link a la tienda)
POST   /app/errores                       (la app reporta un error; ver "Errores de la app")
GET    /cuenta/nueva-password             (página HTML: elegir la contraseña nueva, con el token en #token=)
GET    /cuenta/abrir                      (página HTML: abrir la app; ?destino=login|recuperar-password)

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
