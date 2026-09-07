import type { Request } from "express";
import type { UsuarioDocument } from "../models/Usuario.js";

// Request de una ruta que ya pasó por requireAuth: el usuario está garantizado.
export interface RequestAutenticado extends Request {
  usuario: UsuarioDocument;
}

// Lo que el errorHandler deja en res.locals para que requestLogger lo imprima.
export interface ErrorEnLocals {
  mensaje: string;
  detalles?: unknown;
}
