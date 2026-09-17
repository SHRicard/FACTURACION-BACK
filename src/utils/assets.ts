import path from "node:path";
import { fileURLToPath } from "node:url";

// La carpeta de assets (fuentes Inter y logos) vive en src/emails/assets y el
// script "copy-assets" la copia a dist/emails/assets. Resolviéndola desde acá
// vale igual corriendo con tsx desde src/ que corriendo el JS de dist/.
const carpetaUtils = path.dirname(fileURLToPath(import.meta.url));

export const CARPETA_ASSETS = path.join(carpetaUtils, "..", "emails", "assets");

export const rutaAsset = (nombre: string): string => path.join(CARPETA_ASSETS, nombre);
