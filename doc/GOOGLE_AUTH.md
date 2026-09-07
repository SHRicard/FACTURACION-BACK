# Login con Google

Cómo queda armado el login con Google entre este backend y la app de
React Native + Expo.

El backend **ya está implementado y probado**. Lo que falta es la configuración
en Google Cloud y el lado del front, que es lo que documenta esta guía.

---

## 1. Cómo funciona

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
[README-FRONTEND.md](README-FRONTEND.md) aplica sin cambios.

---

## 2. Google Cloud Console

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

### El SHA-1 de Android

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

## 3. Backend

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

## 4. El endpoint

### `POST /auth/google`

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

### Errores

| Status | `error` | Qué mostrar |
| --- | --- | --- |
| 400 | `El campo "idToken" es requerido` | Bug del front: no llegó el token |
| 401 | `El token de Google no es válido o venció` | "No pudimos validar tu cuenta de Google, probá de nuevo" |
| 401 | `El token de Google no es para esta aplicación...` | Bug de config: los client ID no coinciden |
| 401 | `Google no confirmó que ese email sea tuyo...` | Mostrar tal cual: tiene que entrar con contraseña |
| 429 | `Demasiados intentos...` | Mostrar tal cual |
| 503 | `El login con Google no está configurado...` | Ocultar el botón de Google |

---

## 5. El front (Expo)

### Qué librería usar

El proyecto ya tiene carpetas `ios/` y `android/` (prebuild hecho), así que
corre con **development builds**, no con Expo Go. Con eso la opción recomendada
es:

**`@react-native-google-signin/google-signin`** — usa la hoja nativa de Google
(en Android, Credential Manager). Mejor experiencia y menos casos raros que el
flujo por navegador. Necesita módulo nativo, por eso hay que recompilar.

> La alternativa sin módulo nativo es `expo-auth-session/providers/google`, que
> funciona hasta en Expo Go. Si en algún momento vuelven a Expo Go, es el
> camino; el backend no cambia, sigue recibiendo un `idToken`.

### Instalación

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

### Variables del front

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

### El servicio

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

### Sumarlo al servicio de auth

Sobre el `authService` de [README-FRONTEND.md](README-FRONTEND.md):

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

### En la pantalla de login

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

### Guardar el token

El proyecto ya tiene `secureStorage` (MMKV cifrado) en
`src/services/storage/`. El token de sesión va ahí, no en el storage común:

```ts
import { secureStorageService } from '@/services/storage/storageService';

export const setToken = (t: string) => secureStorageService.setString('token', t);
export const getToken = () => secureStorageService.getString('token');
export const clearToken = () => secureStorageService.remove('token');
```

---

## 6. Qué hace el backend con las cuentas

| Situación | Resultado |
| --- | --- |
| Ya entró con Google antes | Login normal (`existente`) |
| Email nuevo | Crea la cuenta con rol `administrador` y manda el mail de bienvenida (`creada`) |
| Ya tenía cuenta con email + contraseña, **email verificado por Google** | Vincula las dos. Conserva su contraseña y puede entrar de ambas formas (`vinculada`) |
| Ya tenía cuenta, **email NO verificado por Google** | **Rechaza** con 401 |

Ese último caso es la protección importante: sin el chequeo de `email_verified`,
alguien podría crear una cuenta de Google con el email de otra persona y quedarse
con su cuenta. Está probado.

### Cuentas de Google intentando entrar con contraseña

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

## 7. Checklist

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

## 8. Si algo falla

| Síntoma | Causa casi segura |
| --- | --- |
| `DEVELOPER_ERROR` en Android | SHA-1 o package name que no coinciden con el client ID |
| El login abre y cierra sin hacer nada (iOS) | `iosUrlScheme` mal puesto en el plugin |
| Vuelve sin `idToken` | Falta `webClientId` en `configure()` |
| 401 *"no es para esta aplicación"* | El client ID del front no está en el `.env` del backend |
| 503 | Falta `GOOGLE_CLIENT_ID_*` en el backend |
| Anda en dev y falla en producción | El SHA-1 de la keystore de producción no está cargado |
