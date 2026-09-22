export const VERSION_DOCUMENTOS_LEGALES = "2026-09-17";

/**
 * Mail al que escribe una persona para ejercer sus derechos o pedir la baja.
 * Google Play exige que sea uno real y atendido: aparece en los dos
 * documentos y en la página pública de eliminación de cuenta.
 */
export const CONTACTO_LEGAL =
  process.env["LEGAL_CONTACT_EMAIL"] ?? "completar-contacto-legal@ejemplo.com";

/** Cómo se llama la app en la ficha de Play. */
export const NOMBRE_APLICACION = process.env["APP_NAME"] ?? "Facturación FCT";

/**
 * Página pública donde se pide la baja sin estar logueado. Es el "recurso web
 * externo" que Google Play exige declarar junto al borrado dentro de la app.
 */
export const URL_ELIMINACION_CUENTA = `${(
  process.env["API_PUBLIC_URL"] ?? ""
).replace(/\/+$/, "")}/legal/eliminar-cuenta`;

/** Mientras esté en true, los documentos no se pueden publicar en Play. */
export const CONTACTO_SIN_CONFIGURAR = !process.env["LEGAL_CONTACT_EMAIL"];

const contacto = CONTACTO_LEGAL;
const nombreAplicacion = NOMBRE_APLICACION;

export interface DocumentoLegal {
  tipo: "terminos" | "privacidad";
  version: string;
  titulo: string;
  actualizadoEl: string;
  contacto: string;
  secciones: Array<{ titulo: string; contenido: string }>;
}

export const terminosYCondiciones: DocumentoLegal = {
  tipo: "terminos",
  version: VERSION_DOCUMENTOS_LEGALES,
  titulo: `Términos y condiciones de ${nombreAplicacion}`,
  actualizadoEl: VERSION_DOCUMENTOS_LEGALES,
  contacto,
  secciones: [
    {
      titulo: "1. Aceptación",
      contenido:
        "Al crear una cuenta o usar la aplicación, la persona usuaria declara que leyó y acepta estos términos y la Política de privacidad. Si no está de acuerdo, no debe crear ni utilizar una cuenta.",
    },
    {
      titulo: "2. Servicio",
      contenido: `${nombreAplicacion} es una herramienta de gestión para negocios. Permite administrar clientes, productos, tickets, cuentas corrientes, facturas, pagos y métricas. El servicio se ofrece como herramienta de apoyo y no reemplaza asesoramiento contable, legal, financiero ni fiscal.`,
    },
    {
      titulo: "3. Cuenta y seguridad",
      contenido:
        "La persona usuaria debe proporcionar información verdadera, mantener sus credenciales en secreto y avisar de inmediato si detecta un acceso no autorizado. Cada cuenta es personal y no debe compartirse. La persona usuaria es responsable de la información que carga y de los permisos que concede a otras personas de su negocio.",
    },
    {
      titulo: "4. Información del negocio",
      contenido:
        "La aplicación guarda y procesa la información que la persona usuaria incorpora para prestar el servicio. La persona usuaria debe contar con autorización para cargar datos de clientes, contactos, documentos, teléfonos, DNI, operaciones comerciales y cualquier otro dato que ingrese.",
    },
    {
      titulo: "5. Uso permitido",
      contenido:
        "La aplicación debe utilizarse de forma lícita y únicamente para la gestión del negocio. Está prohibido usarla para vulnerar cuentas, cargar datos sin autorización, cometer fraude, distribuir contenido ilegal o intentar afectar la disponibilidad o seguridad del servicio.",
    },
    {
      titulo: "6. WhatsApp, correo y servicios externos",
      contenido:
        "Algunas funciones pueden abrir WhatsApp, enviar correos o utilizar proveedores tecnológicos externos. La persona usuaria decide si inicia esas acciones y debe revisar los términos y políticas de esos servicios. La aplicación no controla las decisiones, disponibilidad ni contenido de servicios de terceros.",
    },
    {
      titulo: "7. Disponibilidad y límites",
      contenido:
        "Se procura mantener el servicio disponible y seguro, pero pueden existir interrupciones por mantenimiento, fallas de proveedores, conectividad o causas ajenas. La información de la aplicación debe respaldarse y verificarse antes de tomar decisiones comerciales importantes.",
    },
    {
      titulo: "8. Propiedad intelectual",
      contenido:
        "La aplicación, su código, diseño y materiales pertenecen a su desarrollador o a sus licenciantes. La persona usuaria conserva los derechos sobre la información que carga, y concede únicamente la autorización necesaria para almacenarla y procesarla para prestar el servicio.",
    },
    {
      titulo: "9. Suspensión y baja",
      contenido:
        `Se podrá suspender una cuenta cuando exista un riesgo de seguridad, incumplimiento de estos términos o requerimiento legal. La persona usuaria puede eliminar su cuenta y sus datos desde la propia aplicación, o pedir la baja en ${URL_ELIMINACION_CUENTA} o escribiendo a ${contacto}, sujeto a las retenciones exigidas por la ley.`,
    },
    {
      titulo: "10. Cambios",
      contenido:
        "Estos términos pueden actualizarse para reflejar cambios del servicio o de la normativa. Cuando el cambio requiera una nueva aceptación, la aplicación volverá a solicitarla y guardará la versión aceptada.",
    },
    {
      titulo: "11. Contacto",
      contenido: `Para consultas, solicitudes de privacidad o eliminación de cuenta: ${contacto}.`,
    },
  ],
};

export const politicaDePrivacidad: DocumentoLegal = {
  tipo: "privacidad",
  version: VERSION_DOCUMENTOS_LEGALES,
  titulo: `Política de privacidad de ${nombreAplicacion}`,
  actualizadoEl: VERSION_DOCUMENTOS_LEGALES,
  contacto,
  secciones: [
    {
      titulo: "1. Responsable y contacto",
      contenido: `El responsable de ${nombreAplicacion} es su desarrollador. Para consultas sobre privacidad, ejercer derechos o pedir la eliminación de una cuenta, escribí a ${contacto}.${CONTACTO_SIN_CONFIGURAR ? " AVISO PARA EL DESARROLLADOR: este contacto todavía es el de ejemplo. Configurá LEGAL_CONTACT_EMAIL con un correo real antes de publicar la aplicación." : ""}`,
    },
    {
      titulo: "2. Datos que se tratan",
      contenido:
        "Según las funciones utilizadas, se pueden tratar nombre, correo electrónico, DNI, foto de perfil, identificador de Google, contraseña almacenada de forma cifrada, datos de la marca, clientes, teléfonos, productos, tickets, facturas, pagos y registros de uso necesarios para seguridad y operación. La contraseña no se guarda en texto plano.",
    },
    {
      titulo: "3. Finalidades",
      contenido:
        "Los datos se utilizan para crear y autenticar cuentas, permitir la gestión del negocio, generar facturas y métricas, enviar comunicaciones solicitadas, recuperar contraseñas, prevenir abusos, mantener la seguridad y cumplir obligaciones legales. No se venden datos personales ni se utilizan para publicidad personalizada.",
    },
    {
      titulo: "4. Proveedores",
      contenido:
        "Los datos pueden alojarse o procesarse mediante proveedores necesarios para la infraestructura, base de datos, correo electrónico, almacenamiento de imágenes, autenticación de Google y generación o entrega de documentos. Esos proveedores solo deben acceder a los datos necesarios para prestar sus servicios y están sujetos a sus propias políticas.",
    },
    {
      titulo: "5. WhatsApp y acciones elegidas por la persona usuaria",
      contenido:
        "Si la persona usuaria elige compartir información mediante WhatsApp, correo u otro servicio externo, esa transferencia también queda alcanzada por la política del proveedor elegido. La aplicación no vende ni comparte datos con terceros para publicidad.",
    },
    {
      titulo: "6. Seguridad",
      contenido:
        "Se aplican medidas razonables, como autenticación, control de acceso, hash de contraseñas y transmisión segura cuando la infraestructura lo permite. Ningún sistema conectado a internet puede garantizar seguridad absoluta; la persona usuaria también debe proteger sus credenciales.",
    },
    {
      titulo: "7. Conservación y eliminación",
      contenido:
        `Los datos se conservan mientras la cuenta y el servicio estén activos. La cuenta se puede eliminar desde la propia aplicación, o pedir la baja en ${URL_ELIMINACION_CUENTA} o escribiendo a ${contacto}; la solicitud se atiende dentro de los 30 días. Al eliminar una cuenta se borran sus datos de perfil y, si era la única dueña de su marca, también los clientes, productos, tickets, facturas, pagos y el logo de esa marca. Si la marca tiene otras personas dueñas, la información del negocio sigue siendo de ellas y solo se quita la referencia a la cuenta eliminada. Se puede conservar por más tiempo únicamente lo exigido por una obligación legal, la resolución de una disputa o la prevención de fraude.`,
    },
    {
      titulo: "8. Derechos",
      contenido: `La persona usuaria puede solicitar acceso, corrección, actualización o eliminación de sus datos, y consultar cómo se tratan, escribiendo a ${contacto}. La respuesta se dará dentro de los plazos aplicables y se podrán pedir datos para verificar la identidad.`,
    },
    {
      titulo: "9. Menores",
      contenido:
        "La aplicación está dirigida a personas que gestionan negocios y no está diseñada para menores de edad. No se solicita deliberadamente información de menores.",
    },
    {
      titulo: "10. Cambios",
      contenido:
        "Esta política puede actualizarse cuando cambien el servicio, los proveedores o las obligaciones aplicables. La versión vigente y su fecha se publican en esta misma ruta.",
    },
  ],
};
