import { Router, type Request, type Response } from "express";
import {
  CONTACTO_LEGAL,
  NOMBRE_APLICACION,
  VERSION_DOCUMENTOS_LEGALES,
  politicaDePrivacidad,
  terminosYCondiciones,
  type DocumentoLegal,
} from "../legal/documentos.js";

const router = Router();

const ESTILO = `body{max-width:820px;margin:0 auto;padding:32px 20px;font:16px/1.6 system-ui,sans-serif;color:#202124}h1{line-height:1.2}h2{margin-top:28px;font-size:1.15rem}small{color:#5f6368}a{color:#4a1866}ol,ul{padding-left:20px}li{margin:8px 0}`;

function htmlDocumento(documento: DocumentoLegal): string {
  const secciones = documento.secciones
    .map(
      ({ titulo, contenido }) =>
        `<section><h2>${titulo}</h2><p>${contenido}</p></section>`,
    )
    .join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${documento.titulo}</title><style>${ESTILO}</style></head><body><h1>${documento.titulo}</h1><small>Versión ${documento.version} · Actualizado el ${documento.actualizadoEl}</small>${secciones}</body></html>`;
}

function responderDocumento(
  documento: DocumentoLegal,
  req: Request,
  res: Response,
): void {
  if (req.query["formato"] !== "json" && req.accepts("html")) {
    res.type("html").send(htmlDocumento(documento));
    return;
  }
  res.json(documento);
}

router.get("/terminos", (req, res) =>
  responderDocumento(terminosYCondiciones, req, res),
);
router.get("/privacidad", (req, res) =>
  responderDocumento(politicaDePrivacidad, req, res),
);

// ─────────────── Eliminación de cuenta ───────────────
//
// Google Play pide DOS caminos para darse de baja: uno dentro de la app
// (DELETE /auth/me/cuenta) y un "recurso web externo" que se pueda abrir sin
// loguearse. Esta página es ese recurso: es la URL que se declara en Play
// Console → Contenido de la app → Seguridad de los datos.
//
// No borra nada por sí sola a propósito: sin sesión no hay forma de probar
// quién pide la baja, así que el pedido por mail se verifica a mano.

/** Qué se borra según con quién comparta la marca. Sale del servicio real. */
const QUE_SE_ELIMINA = [
  "Tu cuenta: nombre, correo, DNI, foto de perfil y el vínculo con Google si lo usaste.",
  "Si sos la única persona dueña de tu marca, también se borra el negocio entero: clientes, productos, especies, tickets, facturas, pagos y el logo.",
  "Si tu marca tiene otras personas dueñas, el negocio sigue siendo de ellas: solo se elimina tu cuenta y se quita tu nombre de los tickets y pagos que habías registrado.",
];

const PAGINA_ELIMINACION = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eliminar tu cuenta de ${NOMBRE_APLICACION}</title>
<style>${ESTILO}</style>
</head>
<body>
<h1>Eliminar tu cuenta de ${NOMBRE_APLICACION}</h1>
<small>Versión ${VERSION_DOCUMENTOS_LEGALES}</small>

<section>
<h2>Desde la aplicación</h2>
<p>Es la forma más rápida y no hace falta esperar a nadie:</p>
<ol>
<li>Entrá a ${NOMBRE_APLICACION} con tu cuenta.</li>
<li>Abrí <strong>Perfil</strong>.</li>
<li>Tocá <strong>Eliminar mi cuenta</strong> y confirmá.</li>
</ol>
<p>La cuenta y los datos que se indican abajo se borran en el momento. No se puede deshacer.</p>
</section>

<section>
<h2>Si no podés entrar a la aplicación</h2>
<p>Escribinos a <a href="mailto:${CONTACTO_LEGAL}?subject=Eliminar%20mi%20cuenta%20de%20${encodeURIComponent(
  NOMBRE_APLICACION,
)}">${CONTACTO_LEGAL}</a> desde el correo con el que te registraste, pidiendo la eliminación de tu cuenta.</p>
<p>Podemos pedirte algún dato más para confirmar que la cuenta es tuya. Respondemos y completamos la baja dentro de los 30 días.</p>
</section>

<section>
<h2>Qué se elimina</h2>
<ul>${QUE_SE_ELIMINA.map((linea) => `<li>${linea}</li>`).join("")}</ul>
</section>

<section>
<h2>Qué se puede conservar</h2>
<p>Solo lo que haga falta guardar por una obligación legal, para resolver una disputa o para prevenir fraude y abusos, y únicamente durante el tiempo que eso exija. Nada de eso se usa para publicidad ni se vende.</p>
</section>

<section>
<h2>Más información</h2>
<p><a href="/legal/privacidad">Política de privacidad</a> · <a href="/legal/terminos">Términos y condiciones</a></p>
</section>
</body>
</html>`;

router.get("/eliminar-cuenta", (req, res) => {
  if (req.query["formato"] === "json" || !req.accepts("html")) {
    res.json({
      tipo: "eliminacion-cuenta",
      version: VERSION_DOCUMENTOS_LEGALES,
      contacto: CONTACTO_LEGAL,
      enLaApp: "Perfil → Eliminar mi cuenta",
      endpoint: "DELETE /auth/me/cuenta",
      plazoDiasSolicitudPorEmail: 30,
      seElimina: QUE_SE_ELIMINA,
    });
    return;
  }
  res.type("html").send(PAGINA_ELIMINACION);
});

export default router;
