import { randomBytes } from "node:crypto";
import { Router, type Response } from "express";
import { NOMBRE_APLICACION } from "../legal/documentos.js";
import { escaparHtml } from "../emails/componentes.js";
import { urlTienda } from "../utils/version.js";

// Páginas HTML de la cuenta que se abren desde un mail (K9).
//
// Las sirve el back porque no hay una web del front publicada ni App Links
// (decisión 3): los clientes de mail no hacen clickeable un link a
// facturacionfront://, así que el mail apunta acá y la página ofrece el botón
// a la app y el link a Play.
//
// El token de reseteo va en el FRAGMENTO (#token=…): el navegador nunca lo
// manda al servidor, así que no queda en el log, en el Referer ni en la caché
// de un proxy. La página lo lee con JS, lo saca de la barra enseguida y habla
// con los mismos endpoints de /auth que usa la app (same-origin, sin CORS).

const router = Router();

const ESQUEMA_POR_DEFECTO = "facturacionfront";

/** El scheme de la app. Validado: termina adentro de un href y de un <script>. */
function esquemaApp(): string {
  const configurado = process.env["APP_SCHEME"]?.trim();
  return configurado && /^[a-z][a-z0-9+.-]*$/.test(configurado)
    ? configurado
    : ESQUEMA_POR_DEFECTO;
}

/**
 * No se cachea (la página de reseteo es de un solo uso), no se indexa, no
 * manda Referer a ningún lado y solo corre el script que lleva el nonce de
 * esta respuesta.
 */
function cabeceras(res: Response, scriptSrc: string): void {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow",
    "Content-Security-Policy": `default-src 'none'; script-src ${scriptSrc}; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
  });
}

// Mismo estilo que el "link no disponible" de routes/publico.ts: fondo lila,
// tarjeta blanca y violeta de la marca. Botones de 48px o más para el dedo.
const ESTILO = `
  [hidden] { display: none !important; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px 16px;
         background: #f4f0f8; color: #1f1626;
         font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
  main { width: 100%; max-width: 400px; background: #fff; border: 1px solid #e8ddf0; border-radius: 14px; padding: 28px; }
  h1 { margin: 0 0 12px; font-size: 21px; line-height: 1.3; color: #4a1866; overflow-wrap: anywhere; }
  p { margin: 0 0 16px; line-height: 1.5; color: #5b5165; }
  label { display: block; margin: 0 0 6px; font-weight: 600; font-size: 15px; }
  input { display: block; width: 100%; min-height: 48px; margin: 0 0 16px; padding: 10px 14px;
          font: inherit; color: inherit; border: 1px solid #cdbfd9; border-radius: 10px; }
  input:focus { outline: 2px solid #4a1866; outline-offset: 1px; }
  .boton { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 48px;
           margin: 0 0 12px; padding: 12px 20px; border: 0; border-radius: 10px;
           background: #4a1866; color: #fff; font: inherit; font-weight: 600; text-decoration: none; cursor: pointer; }
  .boton:disabled { opacity: .6; cursor: default; }
  .secundario { background: #fff; color: #4a1866; border: 1px solid #4a1866; }
  .error { color: #b3261e; font-size: 15px; margin-top: -8px; }
  .error:empty { display: none; }
  .nota { font-size: 14px; margin: 8px 0 0; }
  a { color: #4a1866; }
`;

function pagina(titulo: string, cuerpo: string, script = ""): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escaparHtml(titulo)} · ${escaparHtml(NOMBRE_APLICACION)}</title>
  <style>${ESTILO}</style>
</head>
<body>
  <main>
${cuerpo}
  </main>
${script}
</body>
</html>`;
}

// ───────────────────── Elegir contraseña nueva ─────────────────────
// GET /cuenta/nueva-password#token=<hex de 64>
//
// Estados de la página: cargando → formulario → listo, o alguno de los de
// error (incompleto, vencido, demasiados, sinRed). Todos van en el HTML con
// `hidden` y el script muestra uno a la vez.
router.get("/nueva-password", (_req, res) => {
  const nonce = randomBytes(16).toString("base64");
  const esquema = esquemaApp();
  const tienda = escaparHtml(urlTienda());
  const pedirOtro = `<a class="boton" href="${esquema}://recuperar-password">Abrir la app para pedir otro</a>`;

  const cuerpo = `
    <noscript>
      <style>#cargando { display: none; }</style>
      <h1>Hace falta JavaScript</h1>
      <p>Esta página necesita JavaScript para cambiar la contraseña. Activalo y volvé a abrir el link del mail.</p>
    </noscript>

    <section id="cargando">
      <h1>Revisando el link…</h1>
    </section>

    <section id="incompleto" hidden>
      <h1>Este link está incompleto</h1>
      <p>Puede que se haya cortado al copiarlo. Pedí uno nuevo desde la app.</p>
      ${pedirOtro}
    </section>

    <section id="vencido" hidden>
      <h1>Este link venció o ya se usó</h1>
      <p>Por seguridad, cada link dura un rato y sirve una sola vez. Pedí uno nuevo desde la app.</p>
      ${pedirOtro}
    </section>

    <section id="demasiados" hidden>
      <h1>Demasiados intentos</h1>
      <p id="demasiados-texto">Probá de nuevo en unos minutos.</p>
    </section>

    <section id="sinRed" hidden>
      <h1>No pudimos conectarnos</h1>
      <p>Revisá tu conexión y probá de nuevo.</p>
      <button type="button" class="boton" id="reintentar">Probar de nuevo</button>
    </section>

    <section id="formulario" hidden>
      <h1>Nueva contraseña para <span id="email"></span></h1>
      <form id="form" novalidate>
        <label for="password">Contraseña nueva</label>
        <input id="password" name="password" type="password" autocomplete="new-password" required>
        <label for="repetir">Repetí la contraseña</label>
        <input id="repetir" name="repetir" type="password" autocomplete="new-password" required>
        <p id="error-password" class="error" role="alert"></p>
        <button type="submit" class="boton" id="guardar">Guardar contraseña</button>
      </form>
      <a class="boton secundario" id="seguir" href="${esquema}://recuperar-password">Seguir en la app</a>
    </section>

    <section id="listo" hidden>
      <h1>Listo. Ya podés entrar con tu contraseña nueva</h1>
      <a class="boton" href="${esquema}://login">Abrir la app</a>
      <p class="nota">¿No tenés la app en este teléfono? <a href="${tienda}">Bajar la app de Google Play</a></p>
    </section>`;

  // Rutas relativas ('../auth/…'): resuelven bien aunque API_PUBLIC_URL tenga
  // un prefijo de ruta, y cumplen connect-src 'self'.
  const script = `  <script nonce="${nonce}">
  (function () {
    "use strict";
    var ESQUEMA = ${JSON.stringify(esquema)};
    var ESTADOS = ["cargando", "incompleto", "vencido", "demasiados", "sinRed", "formulario", "listo"];
    var $ = function (id) { return document.getElementById(id); };

    function mostrar(estado) {
      ESTADOS.forEach(function (e) { $(e).hidden = e !== estado; });
    }

    // El token vive solo en esta variable: se saca de la barra y del historial.
    var token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
    history.replaceState(null, "", location.pathname);

    function demasiados(respuesta) {
      var segundos = Number(respuesta.headers.get("Retry-After"));
      var minutos = segundos > 0 ? Math.ceil(segundos / 60) : 0;
      $("demasiados-texto").textContent = minutos
        ? "Demasiados intentos, probá en " + minutos + (minutos === 1 ? " minuto." : " minutos.")
        : "Demasiados intentos, probá en unos minutos.";
      mostrar("demasiados");
    }

    async function leerJson(respuesta) {
      try { return await respuesta.json(); } catch (e) { return null; }
    }

    async function validar() {
      mostrar("cargando");
      var respuesta;
      try {
        respuesta = await fetch("../auth/recuperar-password/" + encodeURIComponent(token), {
          headers: { Accept: "application/json" }
        });
      } catch (e) {
        mostrar("sinRed");
        return;
      }
      if (respuesta.status === 429) return demasiados(respuesta);
      if (respuesta.status >= 500) return mostrar("sinRed");
      if (!respuesta.ok) return mostrar("vencido");

      var data = await leerJson(respuesta);
      $("email").textContent = data && typeof data.email === "string" ? data.email : "tu cuenta";
      $("seguir").href = ESQUEMA + "://resetear-password?token=" + token;
      mostrar("formulario");
    }

    $("reintentar").addEventListener("click", validar);

    $("form").addEventListener("submit", async function (evento) {
      evento.preventDefault();
      var error = $("error-password");
      var boton = $("guardar");
      var password = $("password").value;
      error.textContent = "";

      if (!password) {
        error.textContent = "Escribí la contraseña nueva.";
        $("password").focus();
        return;
      }
      if (password !== $("repetir").value) {
        error.textContent = "Las dos contraseñas no coinciden.";
        $("repetir").focus();
        return;
      }

      boton.disabled = true;
      var respuesta;
      try {
        respuesta = await fetch("../auth/resetear-password", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ token: token, password: password })
        });
      } catch (e) {
        error.textContent = "No pudimos conectarnos. Revisá tu conexión y probá de nuevo.";
        boton.disabled = false;
        return;
      }

      // La respuesta trae una sesión para la app; acá no se usa.
      if (respuesta.ok) return mostrar("listo");
      if (respuesta.status === 429) return demasiados(respuesta);

      var data = await leerJson(respuesta);
      var campo = data && data.detalles && data.detalles.campos && data.detalles.campos.password;
      if (respuesta.status === 400 && typeof campo === "string") {
        error.textContent = campo;
        boton.disabled = false;
        $("password").focus();
        return;
      }
      if (respuesta.status === 400) return mostrar("vencido");

      error.textContent = "Algo salió mal. Probá de nuevo en un rato.";
      boton.disabled = false;
    });

    if (!/^[0-9a-f]{64}$/i.test(token)) mostrar("incompleto");
    else validar();
  })();
  </script>`;

  cabeceras(res, `'nonce-${nonce}'`);
  res.type("html").send(pagina("Nueva contraseña", cuerpo, script));
});

// ───────────────────────── Abrir la app ─────────────────────────
// GET /cuenta/abrir?destino=login|recuperar-password
//
// A dónde apuntan los mails de bienvenida, "contraseña cambiada" y "cuenta
// vinculada". Sin script: un botón al scheme y el link a Play.
router.get("/abrir", (req, res) => {
  const esquema = esquemaApp();
  // Lista blanca: cualquier otra cosa (un javascript:, otra pantalla) es login.
  const destino = req.query["destino"] === "recuperar-password" ? "recuperar-password" : "login";
  const nombre = escaparHtml(NOMBRE_APLICACION);

  const cuerpo = `
    <h1>Abrí ${nombre}</h1>
    ${
      destino === "recuperar-password"
        ? "<p>En la app tocá <strong>¿Olvidaste tu contraseña?</strong> y pedí un link nuevo.</p>"
        : ""
    }
    <a class="boton" href="${esquema}://${destino}">Abrir la app</a>
    <p class="nota">¿No la tenés instalada? <a href="${escaparHtml(urlTienda())}">Bajala de Google Play</a></p>`;

  cabeceras(res, "'none'");
  res.type("html").send(pagina("Abrir la app", cuerpo));
});

export default router;
