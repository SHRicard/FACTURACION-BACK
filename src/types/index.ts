import type { Request } from "express";
import type { UsuarioDocument } from "../models/Usuario.js";
import type { MarcaDocument } from "../models/Marca.js";

// Request de una ruta que ya pasó por requireAuth: el usuario está garantizado.
export interface RequestAutenticado extends Request {
  usuario: UsuarioDocument;
}

// Request de una ruta del negocio: pasó por requireAuth y requireMarca, así
// que también está la marca del usuario. Todo se filtra por req.marca._id.
export interface RequestConMarca extends RequestAutenticado {
  marca: MarcaDocument;
}

// Lo que el errorHandler deja en res.locals para que requestLogger lo imprima.
export interface ErrorEnLocals {
  mensaje: string;
  detalles?: unknown;
}
