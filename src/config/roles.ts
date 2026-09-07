/**
 * Los roles del sistema, declarados en un solo lugar.
 *
 * MVP: solo `super_admin` y `administrador`.
 *
 * Para agregar un rol nuevo (por ejemplo `cliente`, que está planificado):
 *   1. Sumarlo a ROLES.
 *   2. Describirlo en DESCRIPCION_ROLES — TypeScript lo va a exigir.
 *   3. Proteger las rutas que correspondan con requireRol("cliente").
 * El enum del schema de mongoose sale de acá, así que no hay que tocarlo.
 */
export const ROLES = ["super_admin", "administrador"] as const;

export type Rol = (typeof ROLES)[number];

/**
 * El rol que recibe TODO usuario que se registra por su cuenta, tanto por
 * /auth/registro como por /auth/google.
 *
 * Nunca se toma del body: si no, cualquiera se daría de alta como super_admin.
 */
export const ROL_POR_DEFECTO = "administrador" satisfies Rol;

/** Qué puede hacer cada rol. Es la referencia, no se evalúa en runtime. */
export const DESCRIPCION_ROLES: Record<Rol, string> = {
  super_admin:
    "Administra la plataforma. Único que entra a /usuarios para crear y borrar cuentas. " +
    "Se crea solo al arrancar el servidor, desde SUPER_ADMIN_EMAIL.",
  administrador:
    "Dueño de un negocio. Gestiona sus propios clientes, productos y movimientos. " +
    "No ve los datos de otros administradores.",
};

/** Type guard para validar un rol que llega de afuera (body, query, token). */
export const esRol = (valor: unknown): valor is Rol =>
  typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
