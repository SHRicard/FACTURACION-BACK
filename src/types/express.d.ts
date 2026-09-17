import type { UsuarioDocument } from "../models/Usuario.js";
import type { MarcaDocument } from "../models/Marca.js";

// Le agregamos "usuario" y "marca" al Request de Express. Van como opcionales
// porque en las rutas públicas (login, registro) todavía no hay nadie
// logueado; para las rutas protegidas se usan RequestAutenticado y
// RequestConMarca, donde son obligatorios.
declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioDocument;
      marca?: MarcaDocument;
    }
  }
}

export {};
