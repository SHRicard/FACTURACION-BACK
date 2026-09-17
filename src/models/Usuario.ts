import mongoose, {
  Schema,
  type HydratedDocument,
  type Model,
  type Types,
} from "mongoose";
import { ROLES, ROL_POR_DEFECTO, type Rol } from "../config/roles.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";

// Cuánto vive el token de recuperación de contraseña.
export const MINUTOS_VALIDEZ_RESET = 60;

// Los roles se declaran en config/roles.ts. Se re-exportan acá porque casi
// todo el código que necesita el tipo ya importa el modelo.
export { ROLES, ROL_POR_DEFECTO, esRol, type Rol } from "../config/roles.js";

export const PROVEEDORES = ["local", "google"] as const;
export type Proveedor = (typeof PROVEEDORES)[number];

export interface UsuarioAtributos {
  nombre: string;
  email: string;
  /**
   * DNI, sin puntos. Obligatorio para operar: se pide en "completá tu perfil"
   * después de registrarse. Es único y es con lo que un dueño suma a otro a
   * su marca, así que no lo cambia el usuario: lo corrige el super_admin.
   */
  dni?: string;
  /**
   * La marca en la que trabaja. Una sola: no se pasa de una a otra. Sin
   * marca no puede operar (ver middleware/marca.ts).
   */
  marca?: Types.ObjectId | null;
  /** Opcional: las cuentas creadas con Google no tienen contraseña. */
  password?: string;
  rol: Rol;

  // --- Identidad ---
  /** Con qué se creó la cuenta. No cambia aunque después se vincule Google. */
  proveedor: Proveedor;
  /** "sub" del token de Google: su id de usuario, estable y único. */
  googleId?: string;
  /** Foto de perfil que devuelve Google. */
  avatar?: string;

  /** Aceptación explícita de los documentos legales vigentes. */
  aceptoTerminosYCondiciones: boolean;
  terminosYCondicionesVersion?: string;
  terminosYCondicionesAceptadosEn?: Date;

  // --- Recuperación de contraseña ---
  // Guardamos el HASH del token, no el token. Si alguien lee la base no puede
  // usarlo para resetear la contraseña de nadie.
  resetPasswordToken?: string;
  resetPasswordExpira?: Date;

  // Momento del último cambio de contraseña. Sirve para invalidar los JWT
  // emitidos antes: si cambiaste la contraseña, las sesiones viejas se caen.
  passwordCambiadoEn?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export interface UsuarioMetodos {
  compararPassword(passwordPlano: string): Promise<boolean>;
  passwordCambioDespuesDelToken(emitidoEn: number): boolean;
  generarTokenReset(): string;
}

export type UsuarioDocument = HydratedDocument<
  UsuarioAtributos,
  UsuarioMetodos
>;
type UsuarioModel = Model<
  UsuarioAtributos,
  Record<string, never>,
  UsuarioMetodos
>;

const usuarioSchema = new Schema<
  UsuarioAtributos,
  UsuarioModel,
  UsuarioMetodos
>(
  {
    nombre: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    dni: { type: String, trim: true, match: /^\d{7,8}$/ },
    marca: { type: Schema.Types.ObjectId, ref: "Marca" },
    password: {
      type: String,
      minlength: 6,
      select: false,
      // Solo obligatoria si no hay cuenta de Google vinculada: quien entra con
      // Google nunca define una.
      required: function (this: { googleId?: string }) {
        return !this.googleId;
      },
    },
    rol: { type: String, enum: ROLES, default: ROL_POR_DEFECTO },

    proveedor: { type: String, enum: PROVEEDORES, default: "local" },
    // sparse: permite muchos documentos sin googleId, pero no dos con el mismo.
    googleId: { type: String, unique: true, sparse: true },
    avatar: { type: String },

    aceptoTerminosYCondiciones: { type: Boolean, default: false },
    terminosYCondicionesVersion: { type: String },
    terminosYCondicionesAceptadosEn: { type: Date },

    resetPasswordToken: { type: String, select: false },
    resetPasswordExpira: { type: Date, select: false },
    passwordCambiadoEn: { type: Date, select: false },
  },
  { timestamps: true },
);

// El DNI no se repite entre cuentas. Parcial y no `sparse`, por la misma razón
// que el correlativo de las facturas: solo cuenta a los que ya lo cargaron.
usuarioSchema.index(
  { dni: 1 },
  { unique: true, partialFilterExpression: { dni: { $type: "string" } } },
);
// Los dueños de una marca (el virtual `duenos` de Marca busca por acá).
usuarioSchema.index({ marca: 1 });

// Hashea el password antes de guardar, solo si cambió
usuarioSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 10);
  // Restamos un segundo para cubrir el caso de que el JWT se emita en el mismo
  // segundo que el guardado y quede invalidado por error.
  if (!this.isNew) this.passwordCambiadoEn = new Date(Date.now() - 1000);
  next();
});

// Compara un password plano contra el hash guardado
usuarioSchema.methods.compararPassword = async function (
  passwordPlano: string,
): Promise<boolean> {
  // Cuenta creada con Google: no hay hash contra el cual comparar.
  if (!this.password) return false;
  return bcrypt.compare(passwordPlano, this.password);
};

// ¿El token se emitió antes del último cambio de contraseña?
usuarioSchema.methods.passwordCambioDespuesDelToken = function (
  emitidoEn: number,
): boolean {
  if (!this.passwordCambiadoEn) return false;
  return this.passwordCambiadoEn.getTime() > emitidoEn * 1000;
};

// Genera el token de reseteo: devuelve el token plano (va en el mail) y deja
// guardado el hash con su vencimiento. Hay que hacer .save() después.
usuarioSchema.methods.generarTokenReset = function (): string {
  const token = crypto.randomBytes(32).toString("hex");

  this.resetPasswordToken = hashearToken(token);
  this.resetPasswordExpira = new Date(
    Date.now() + MINUTOS_VALIDEZ_RESET * 60 * 1000,
  );

  return token;
};

// Hashea un token plano para poder buscarlo en la base.
export const hashearToken = (token: string): string =>
  crypto.createHash("sha256").update(token).digest("hex");

// Nunca devolver el hash del password en las respuestas JSON
usuarioSchema.set("toJSON", {
  transform: (_doc, ret) => {
    // Sacamos los campos sensibles quedándonos con el resto.
    const {
      password,
      resetPasswordToken,
      resetPasswordExpira,
      passwordCambiadoEn,
      ...publico
    } = ret;
    return publico;
  },
});

export default mongoose.model<UsuarioAtributos, UsuarioModel>(
  "Usuario",
  usuarioSchema,
);
