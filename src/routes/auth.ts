import { Router } from "express";
import jwt from "jsonwebtoken";
import Usuario, {
  MINUTOS_VALIDEZ_RESET,
  hashearToken,
  type UsuarioDocument,
} from "../models/Usuario.js";
import { ROL_POR_DEFECTO } from "../config/roles.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimit, limpiarRateLimit } from "../middleware/rateLimit.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { datosInvalidos, noAutorizado } from "../utils/AppError.js";
import { verificarIdTokenGoogle } from "../utils/google.js";
import { resolverUsuarioGoogle } from "../services/googleAuth.js";
import { logger } from "../utils/logger.js";
import { enviarEmail } from "../utils/email.js";
import {
  adjuntoLogo,
  bienvenida,
  recuperarPassword,
  passwordCambiado,
} from "../emails/index.js";
import type { RequestAutenticado } from "../types/index.js";

const router = Router();

const DIAS_VALIDEZ_TOKEN = "7d";
const LARGO_MINIMO_PASSWORD = 6;

/** Lo que devuelven registro, login y reseteo: el front espera siempre esta forma. */
interface RespuestaSesion {
  token: string;
  usuario: unknown;
}

function firmarToken(usuario: UsuarioDocument): string {
  const secreto = process.env["JWT_SECRET"];
  if (!secreto) throw new Error("Falta la variable JWT_SECRET en el .env");

  return jwt.sign({ id: usuario._id.toString(), rol: usuario.rol }, secreto, {
    expiresIn: DIAS_VALIDEZ_TOKEN,
  });
}

const respuestaSesion = (usuario: UsuarioDocument): RespuestaSesion => ({
  token: firmarToken(usuario),
  usuario: usuario.toJSON(),
});

const EMAIL_VALIDO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Base del front, sin barra final. De acá salen los links de los mails. */
const urlFront = (ruta = ""): string => {
  const base = (process.env["FRONTEND_URL"] ?? "http://localhost:5173").replace(/\/$/, "");
  return `${base}${ruta}`;
};

function validarPassword(password: unknown, campo = "password"): asserts password is string {
  if (!password || typeof password !== "string") {
    throw datosInvalidos(`El campo "${campo}" es requerido`);
  }
  if (password.length < LARGO_MINIMO_PASSWORD) {
    throw datosInvalidos(`La contraseña debe tener al menos ${LARGO_MINIMO_PASSWORD} caracteres`);
  }
}

function exigirTexto(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || !valor.trim()) {
    throw datosInvalidos(`El campo "${campo}" es requerido`);
  }
  return valor.trim();
}

// ───────────────────────── Registro ─────────────────────────
// POST /auth/registro   { nombre, email, password }
// Crea una cuenta nueva con rol "administrador" y ya devuelve la sesión.
router.post(
  "/registro",
  rateLimit({ nombre: "registro", maximo: 10, ventanaMs: 60 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const nombre = exigirTexto(req.body?.nombre, "nombre");
    const email = exigirTexto(req.body?.email, "email").toLowerCase();
    const { password } = req.body ?? {};

    if (!EMAIL_VALIDO.test(email)) throw datosInvalidos("El email no tiene un formato válido");
    validarPassword(password);

    // El índice único también lo cubre (devolvería 409), pero chequear acá da
    // un mensaje más claro y evita gastar un hash de bcrypt al pedo.
    const yaExiste = await Usuario.findOne({ email });
    if (yaExiste) throw datosInvalidos("Ya hay una cuenta registrada con ese email");

    // Ojo: el rol NUNCA sale del body. Si no, cualquiera se registra de
    // super_admin mandando { rol: "super_admin" }.
    const usuario = await Usuario.create({
      nombre,
      email,
      password,
      // El rol no se toma del body: toda cuenta nueva nace administrador.
      rol: ROL_POR_DEFECTO,
    });

    logger.success(`Cuenta nueva: ${usuario.email}`);

    // El mail de bienvenida no debe frenar ni romper el registro.
    const mail = bienvenida({
      nombre: usuario.nombre,
      email: usuario.email,
      urlApp: urlFront("/login"),
    });
    void enviarEmail({ para: usuario.email, ...mail, adjuntos: [adjuntoLogo()] });

    res.status(201).json(respuestaSesion(usuario));
  })
);

// ───────────────────────── Login ─────────────────────────
// POST /auth/login   { email, password }
router.post(
  "/login",
  rateLimit({ nombre: "login", maximo: 10, ventanaMs: 15 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      throw datosInvalidos("Email y password son requeridos");
    }

    // El password tiene select:false en el schema, hay que pedirlo explícito.
    const usuario = await Usuario.findOne({ email: String(email).toLowerCase() }).select(
      "+password"
    );

    // Mismo mensaje exista o no el usuario: si no, se puede averiguar qué
    // emails están registrados probando de a uno.
    if (!usuario) throw noAutorizado("Credenciales inválidas");

    // Cuenta creada con Google: no tiene contraseña que comparar. Se lo decimos,
    // porque acá no revelamos nada que el usuario no sepa ya de su propia cuenta.
    if (!usuario.password) {
      throw noAutorizado("Esta cuenta usa Google para entrar. Tocá \"Continuar con Google\".");
    }

    const passwordOk = await usuario.compararPassword(String(password));
    if (!passwordOk) throw noAutorizado("Credenciales inválidas");

    limpiarRateLimit("login", req);
    res.json(respuestaSesion(usuario));
  })
);

// ───────────────────────── Google ─────────────────────────
// POST /auth/google   { idToken }
//
// El front hace todo el baile de OAuth con Google y manda acá el ID token.
// Nunca mandamos ni aceptamos email/nombre por separado: se leen del token ya
// verificado contra las claves públicas de Google.
router.post(
  "/google",
  rateLimit({ nombre: "google", maximo: 20, ventanaMs: 15 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const idToken = exigirTexto(req.body?.idToken, "idToken");

    // El perfil sale del token ya verificado contra las claves de Google.
    const perfil = await verificarIdTokenGoogle(idToken);
    const { usuario, caso } = await resolverUsuarioGoogle(perfil);

    if (caso === "creada") {
      const mail = bienvenida({
        nombre: usuario.nombre,
        email: usuario.email,
        urlApp: urlFront("/login"),
      });
      void enviarEmail({ para: usuario.email, ...mail, adjuntos: [adjuntoLogo()] });
    }

    limpiarRateLimit("google", req);
    // "caso" le sirve al front para decidir si mostrar un onboarding.
    res.status(caso === "creada" ? 201 : 200).json({ ...respuestaSesion(usuario), caso });
  })
);

// ───────────────────────── Sesión actual ─────────────────────────
// GET /auth/me — para que el front rehidrate la sesión al recargar la página.
router.get(
  "/me",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    res.json({ usuario: req.usuario.toJSON() });
  })
);

// ───────────────────── Recuperación: paso 1 ─────────────────────
// POST /auth/recuperar-password   { email }
// Manda el mail con el link. Responde siempre lo mismo, exista o no el email.
router.post(
  "/recuperar-password",
  rateLimit({ nombre: "recuperar", maximo: 5, ventanaMs: 15 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const email = exigirTexto(req.body?.email, "email").toLowerCase();

    // Respuesta genérica: no confirmamos si el email existe.
    const respuesta = {
      mensaje: "Si el email está registrado, te va a llegar un link para recuperar la contraseña.",
    };

    const usuario = await Usuario.findOne({ email });
    if (!usuario) {
      logger.debug(`Recuperación pedida para un email inexistente: ${email}`);
      res.json(respuesta);
      return;
    }

    const token = usuario.generarTokenReset();
    await usuario.save({ validateBeforeSave: false });

    const url = urlFront(`/resetear-password?token=${token}`);

    const mail = recuperarPassword({
      nombre: usuario.nombre,
      url,
      minutos: MINUTOS_VALIDEZ_RESET,
    });

    const envio = await enviarEmail({
      para: usuario.email,
      ...mail,
      adjuntos: [adjuntoLogo()],
    });

    // Si el mail no salió, el token quedaría guardado sin que nadie pueda
    // usarlo. Lo borramos para que pueda pedir otro enseguida.
    if (!envio.enviado && process.env["NODE_ENV"] === "production") {
      usuario.resetPasswordToken = undefined;
      usuario.resetPasswordExpira = undefined;
      await usuario.save({ validateBeforeSave: false });
    }

    res.json(respuesta);
  })
);

// ───────────────────── Recuperación: paso 2 ─────────────────────
// GET /auth/recuperar-password/:token
// Para que el front sepa si mostrar el formulario o "el link venció".
router.get(
  "/recuperar-password/:token",
  asyncHandler(async (req, res) => {
    const usuario = await Usuario.findOne({
      resetPasswordToken: hashearToken(String(req.params["token"])),
      resetPasswordExpira: { $gt: new Date() },
    });

    if (!usuario) throw datosInvalidos("El link no es válido o ya venció");

    res.json({ valido: true, email: usuario.email });
  })
);

// ───────────────────── Recuperación: paso 3 ─────────────────────
// POST /auth/resetear-password   { token, password }
router.post(
  "/resetear-password",
  rateLimit({ nombre: "resetear", maximo: 10, ventanaMs: 15 * 60 * 1000 }),
  asyncHandler(async (req, res) => {
    const token = exigirTexto(req.body?.token, "token");
    const { password } = req.body ?? {};
    validarPassword(password);

    const usuario = await Usuario.findOne({
      resetPasswordToken: hashearToken(token),
      resetPasswordExpira: { $gt: new Date() },
    });

    if (!usuario) throw datosInvalidos("El link no es válido o ya venció");

    usuario.password = password;
    // El token es de un solo uso.
    usuario.resetPasswordToken = undefined;
    usuario.resetPasswordExpira = undefined;
    await usuario.save();

    logger.success(`Contraseña restablecida: ${usuario.email}`);

    const aviso = passwordCambiado({
      nombre: usuario.nombre,
      urlRecuperar: urlFront("/recuperar-password"),
    });
    void enviarEmail({ para: usuario.email, ...aviso, adjuntos: [adjuntoLogo()] });

    // Devolvemos la sesión ya iniciada para que el front no pida login de nuevo.
    res.json(respuestaSesion(usuario));
  })
);

// ───────────────────── Cambio con sesión iniciada ─────────────────────
// POST /auth/cambiar-password   { passwordActual, passwordNueva }
router.post(
  "/cambiar-password",
  requireAuth,
  asyncHandler<RequestAutenticado>(async (req, res) => {
    const { passwordActual, passwordNueva } = req.body ?? {};
    if (!passwordActual) throw datosInvalidos('El campo "passwordActual" es requerido');
    validarPassword(passwordNueva, "passwordNueva");

    const usuario = await Usuario.findById(req.usuario._id).select("+password");
    if (!usuario) throw noAutorizado("Usuario no encontrado");

    // Una cuenta de Google no tiene contraseña actual que confirmar. Para
    // ponerse una tiene que pasar por "recuperar contraseña".
    if (!usuario.password) {
      throw datosInvalidos(
        "Tu cuenta entra con Google y no tiene contraseña. Si querés ponerle una, usá \"Olvidé mi contraseña\"."
      );
    }

    const passwordOk = await usuario.compararPassword(String(passwordActual));
    if (!passwordOk) throw noAutorizado("La contraseña actual no es correcta");

    if (passwordActual === passwordNueva) {
      throw datosInvalidos("La contraseña nueva tiene que ser distinta de la actual");
    }

    usuario.password = passwordNueva;
    await usuario.save();

    logger.success(`Contraseña cambiada: ${usuario.email}`);

    const aviso = passwordCambiado({
      nombre: usuario.nombre,
      urlRecuperar: urlFront("/recuperar-password"),
    });
    void enviarEmail({ para: usuario.email, ...aviso, adjuntos: [adjuntoLogo()] });

    // El cambio invalida los JWT viejos, así que devolvemos uno nuevo.
    res.json(respuestaSesion(usuario));
  })
);

export default router;
