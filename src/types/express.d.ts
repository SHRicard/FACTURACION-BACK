import type { UsuarioDocument } from "../models/Usuario.js";

// Le agregamos "usuario" al Request de Express. Va como opcional porque en las
// rutas públicas (login, registro) todavía no hay nadie logueado; para las
// rutas protegidas se usa RequestAutenticado, donde es obligatorio.
declare global {
  namespace Express {
    interface Request {
      usuario?: UsuarioDocument;
    }
  }
}

export {};
