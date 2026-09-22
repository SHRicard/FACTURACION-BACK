import path from "node:path";
import pdfMake from "pdfmake";
// Con NodeNext las subrutas de un paquete llevan extensión, aunque solo sea de tipos.
import type { TDocumentDefinitions } from "pdfmake/interfaces.js";
import { CARPETA_ASSETS, rutaAsset } from "../utils/assets.js";

// pdfmake, configurado una sola vez al importar este módulo.
//
// Ojo con el import: pdfmake 0.3 es CommonJS y exporta UNA INSTANCIA, no una
// clase. Va como default import; con named imports o `import * as` los
// métodos pierden el `this` (mismo problema que jsonwebtoken, ver
// errorHandler.ts).

const regular = rutaAsset("Inter_18pt-Regular.ttf");
const semibold = rutaAsset("Inter_18pt-SemiBold.ttf");
const bold = rutaAsset("Inter_18pt-Bold.ttf");

// Las fuentes van como RUTAS, no como Buffer: en Node, pdfmake 0.3 toma
// cualquier objeto como { url, headers } y un Buffer le llega con url
// undefined. No hay Inter itálica en el repo, así que la itálica usa la recta:
// pedir `italics` en algún texto no tiene que romper el PDF.
pdfMake.setFonts({
  Inter: { normal: regular, bold, italics: regular, bolditalics: bold },
  InterSemi: { normal: semibold, bold, italics: semibold, bolditalics: bold },
});

// El PDF nunca va a buscar nada a internet, y del disco solo lee la carpeta
// de assets (las fuentes). El logo de la marca lo trae services/cloudinary.ts
// y llega como data URL, que no pasa por estos chequeos.
const dentroDeAssets = (ruta: string): boolean =>
  path.resolve(ruta).startsWith(CARPETA_ASSETS + path.sep);

pdfMake.setUrlAccessPolicy(() => false);
pdfMake.setLocalAccessPolicy(dentroDeAssets);

/**
 * Arma el PDF en memoria. `createPdf` modifica el documento que recibe, así
 * que cada llamada tiene que traer uno recién armado.
 */
export function renderizarPdf(documento: TDocumentDefinitions): Promise<Buffer> {
  return pdfMake.createPdf(documento).getBuffer();
}
