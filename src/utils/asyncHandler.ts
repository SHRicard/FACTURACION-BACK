import type { NextFunction, Request, RequestHandler, Response } from "express";

// Envuelve un handler async para que un error o una promesa rechazada terminen
// en el middleware de errores.
//
// Express 4 NO atrapa promesas rechazadas: sin esto, un `await` que falla deja
// la request colgada para siempre y no se imprime nada en la consola.
//
//   router.get("/", asyncHandler(async (req, res) => { ... }));
//
// Para rutas detrás de requireAuth se le pasa el tipo de request, y ahí
// req.usuario deja de ser opcional:
//
//   router.get("/", requireAuth, asyncHandler<RequestAutenticado>(async (req, res) => {
//     req.usuario._id  // ← tipado, sin "possibly undefined"
//   }));
export const asyncHandler =
  <R extends Request = Request>(
    fn: (req: R, res: Response, next: NextFunction) => Promise<unknown>
  ): RequestHandler =>
  (req, res, next) => {
    // El cast es seguro porque estas rutas siempre van después de requireAuth,
    // que es quien deja req.usuario cargado.
    Promise.resolve(fn(req as R, res, next)).catch(next);
  };

export default asyncHandler;
