import { type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { CRV_CONTACT_URL, type CommunityPageId } from "../lib/communityPages";

export interface CommunitySection { id: string; title: string; content: ReactNode }
interface ContentGroup { intro: string; sections: CommunitySection[] }

function ContactLink({ children = "Escríbenos por Instagram" }: { children?: ReactNode }) {
  return <a href={CRV_CONTACT_URL} target="_blank" rel="noreferrer">{children} <ArrowSquareOut size={14} aria-hidden="true" /></a>;
}

// Grupos editoriales que se reúnen en tres páginas públicas.
export const COMMUNITY_CONTENT: Record<CommunityPageId | "copyright" | "rules" | "faq" | "support", ContentGroup> = {
  terms: {
    intro: "Las condiciones para consultar el archivo y participar en Coleccionistas de Rock Venezolano (CRV). Nuestro propósito es preservar y difundir la memoria musical venezolana.",
    sections: [
      { id: "proyecto", title: "Un archivo cultural sin fines de lucro", content: <>
        <p>CRV es un proyecto cultural y comunitario sin fines de lucro. Reunimos información sobre artistas, personas, discos, organizaciones y audiovisuales para preservar su historia y dar a conocer el talento venezolano en todo el mundo a través de internet. No lucramos con las obras de terceros que documentamos o promovemos.</p>
        <p>La consulta del catálogo es gratuita. No vendemos la música, las portadas ni los videos de sus titulares. Los servicios externos pueden mostrar publicidad o cobrar por sus propios servicios; sus condiciones son independientes de CRV.</p>
      </> },
      { id: "uso", title: "Uso del sitio y acceso", content: <>
        <p>Estas condiciones regulan el uso de CRV en lo permitido por la legislación aplicable. Puedes consultar el catálogo sin crear una cuenta. La edición y las herramientas de administración requieren autorización del equipo. Protege tus credenciales y avisa si detectas un acceso no autorizado.</p>
        <p>Utiliza el sitio de forma lícita y respetuosa. No se permiten suplantaciones, ataques, acceso a datos restringidos, spam, vandalismo ni consultas automatizadas que eludan controles o perjudiquen el servicio. Para una reutilización masiva del catálogo, contacta al equipo y acuerda el alcance y las condiciones.</p>
        <p>También se aplican las <Link to="/ayuda#reglas">reglas de la comunidad</Link> y la <Link to="/privacidad">política de privacidad</Link>. Enviar una consulta o un reclamo no te obliga a conceder una licencia sobre su contenido.</p>
      </> },
      { id: "obras", title: "Obras y derechos de terceros", content: <>
        <p>Las composiciones, grabaciones, interpretaciones, fotografías, portadas, logos, videos, marcas y textos de terceros pertenecen a sus respectivos titulares. Su inclusión documenta una trayectoria y no implica que CRV sea su propietario, representante o cuente con su respaldo.</p>
        <p>La finalidad cultural, promocional y sin lucro no sustituye los permisos exigibles ni convierte las obras en dominio público. Solo corresponde usar material con autorización, licencia u otra base legal aplicable. Consulta el <Link to="/terminos#reclamos">procedimiento para solicitar crédito, corrección o retirada</Link>.</p>
      </> },
      { id: "aportes", title: "Aportes, ideas y permiso de publicación", content: <>
        <p>Los aportes son voluntarios. Antes de publicar una colaboración original, el equipo debe comunicar estas condiciones al colaborador y obtener su aceptación. Un mensaje privado, una obra encontrada en internet o un aporte anterior a esta edición no se consideran licenciados por la sola publicación de estos términos.</p>
        <p>Al aceptar estas condiciones para aportar material del que puedes disponer, concedes a CRV una licencia no exclusiva, mundial, gratuita y por el plazo legal de protección para conservarlo, reproducirlo, publicarlo, comunicarlo, traducirlo y adaptarlo editorial o técnicamente en el archivo y en sus canales de difusión cultural. Incluye copias de seguridad, migraciones y el trabajo de proveedores que actúen por cuenta de CRV para esas finalidades. Conservas la titularidad y puedes utilizar tu obra en otros lugares.</p>
        <p>La licencia permite corregir, resumir, combinar y actualizar el aporte, respetando la atribución acordada y los derechos morales que correspondan. Su continuidad, en la medida permitida por la ley, busca preservar el archivo aunque dejes de colaborar. No autoriza vender tu obra a terceros ni usos ajenos a estas finalidades.</p>
        <p>Las ideas, sugerencias de funciones y propuestas de mejora que envíes voluntariamente para su implementación pueden ser evaluadas y utilizadas por CRV sin pago, exclusividad, participación en el proyecto ni obligación de implementarlas, salvo acuerdo escrito previo. No envíes información confidencial ni material sobre el que no tengas autorización.</p>
        <p>No corresponde exigir regalías ni reclamar exclusividad por el uso de un aporte dentro del permiso que hayas otorgado, ni por la mera implementación de una idea general. Esta disposición no impide reclamar por usos fuera del permiso, autoría indebidamente atribuida, derechos de terceros o derechos que la ley no permita renunciar. La licencia no se extiende a obras de terceros incluidas sin autorización.</p>
      </> },
      { id: "menores", title: "Menores de edad y contenido sensible", content: <>
        <p><strong>Algunas portadas, imágenes, nombres, letras, títulos y videos pueden incluir desnudos, violencia, lenguaje explícito, referencias sexuales o temas perturbadores y no ser aptos para menores de edad.</strong> La documentación de ese material no expresa aprobación de su contenido.</p>
        <p>CRV no está dirigido a niños ni ofrece un entorno infantil o una clasificación de edad de cada ficha. Madres, padres y representantes deben valorar el contenido, supervisar el acceso de menores y utilizar los controles parentales que consideren necesarios. Si no tienes la edad o capacidad exigida en tu país para aceptar estas condiciones o facilitar datos personales, no lo hagas sin la autorización que corresponda.</p>
        <p>En la medida permitida por la ley, CRV no asume la supervisión parental ni se hace responsable del acceso de menores sin la supervisión de sus representantes o de su exposición al material editorial descrito. Esto no excluye las obligaciones de protección de menores ni las responsabilidades que no puedan limitarse legalmente. <ContactLink>Informa sobre contenido ilícito o un riesgo para un menor</ContactLink>.</p>
      </> },
      { id: "disponibilidad", title: "Información, reproductores y disponibilidad", content: <>
        <p>El catálogo está en construcción y puede contener errores, vacíos o información desactualizada. Las fuentes y herramientas automatizadas, incluida la inteligencia artificial utilizada como apoyo a la investigación, pueden equivocarse; las propuestas requieren revisión editorial. No garantizamos exhaustividad, disponibilidad continua ni que un enlace permanezca activo.</p>
        <p>Los reproductores y enlaces externos dependen de sus plataformas, titulares y restricciones territoriales. CRV no controla sus anuncios, políticas, cambios o interrupciones. Un video bloqueado no borra la existencia documentada de una obra.</p>
        <p>En lo permitido por la ley, el uso del sitio se realiza bajo la responsabilidad del visitante y CRV no responde por daños indirectos derivados de errores del catálogo, interrupciones o servicios de terceros. Ninguna condición excluye responsabilidad por dolo ni otras responsabilidades o derechos irrenunciables.</p>
      </> },
      { id: "moderacion", title: "Moderación y continuidad del archivo", content: <>
        <p>El equipo puede revisar, rechazar, corregir o retirar aportes, así como restringir el acceso de quienes incumplan estas condiciones o comprometan la seguridad. Las decisiones editoriales pueden solicitarse a revisión aportando evidencia.</p>
        <p>Dejar de colaborar no obliga a borrar hechos públicos verificables ni aportes válidamente autorizados. Las solicitudes de privacidad o de derechos de autor se evalúan por separado y pueden exigir corrección, anonimización o retirada.</p>
      </> },
      { id: "cambios", title: "Cambios, legislación y contacto", content: <>
        <p>Publicaremos las modificaciones con su fecha de actualización y avisaremos de cambios sustanciales en el sitio. Una ampliación del permiso sobre aportes anteriores requerirá la aceptación correspondiente; no se impone retroactivamente por seguir navegando.</p>
        <p>Se aplica la legislación que corresponda al caso, incluidos los derechos imperativos del lugar de residencia cuando resulten aplicables. Si una cláusula no es válida, las demás mantienen su efecto en lo legalmente posible. No se impone una renuncia general a reclamar ni un arbitraje obligatorio.</p>
        <p>El equipo administrador de Coleccionistas de Rock Venezolano atiende las consultas mediante el <ContactLink>canal de contacto de CRV</ContactLink>.</p>
      </> },
    ],
  },
  privacy: {
    intro: "Qué información utiliza CRV, con qué finalidad y cómo solicitar su revisión. Esta política describe el catálogo y sus herramientas actuales.",
    sections: [
      { id: "responsable", title: "Quién atiende tus datos", content: <>
        <p>El equipo administrador de Coleccionistas de Rock Venezolano gestiona la información del proyecto. Para consultas de privacidad, acceso, corrección o supresión, <ContactLink>contacta al equipo de CRV</ContactLink> e indica «Privacidad». No publiques documentos de identidad, contraseñas ni datos sensibles en comentarios o en el buscador.</p>
      </> },
      { id: "datos", title: "Información que utilizamos", content: <>
        <ul>
          <li><strong>Consulta del sitio:</strong> datos técnicos necesarios para entregar las páginas, mantener la seguridad y limitar abusos, como la dirección IP durante la conexión, solicitudes, fechas y errores. Los registros técnicos pueden variar según el alojamiento.</li>
          <li><strong>Acceso autorizado:</strong> identificador de cuenta, nombre o alias, rol, información necesaria para verificar credenciales y sesión, y registros de acceso y cambios. Las contraseñas locales se verifican mediante un resumen criptográfico, no se guardan en texto legible.</li>
          <li><strong>Búsquedas y descubrimiento:</strong> consultas depuradas, resultados y métricas de funcionamiento para corregir búsquedas fallidas y mejorar el catálogo. Se filtran patrones como correos, teléfonos y secretos; el filtro puede no detectar todos los datos personales.</li>
          <li><strong>Contacto y aportes:</strong> nombre o alias, medio de contacto, mensaje, fuentes y materiales que decidas enviar. Un aporte publicado y su crédito pueden quedar visibles; una conversación privada no se publica automáticamente.</li>
          <li><strong>Personas documentadas:</strong> información pública relacionada con su actividad musical, como nombre artístico, créditos, trayectoria, imágenes y enlaces profesionales, sujeta a revisión y a los derechos aplicables.</li>
        </ul>
      </> },
      { id: "finalidades", title: "Para qué y con qué fundamento", content: <>
        <p>Utilizamos la información para ofrecer el catálogo, gestionar accesos, investigar y corregir fichas, preservar fuentes, responder solicitudes y prevenir abusos. No vendemos datos personales ni utilizamos las consultas para publicidad personalizada.</p>
        <p>Cuando la ley exija identificar una base de tratamiento, recurrimos, según el caso, a la prestación del servicio solicitado, al consentimiento cuando sea necesario, al interés legítimo en mantener un archivo cultural y seguro tras considerar los derechos de las personas, o al cumplimiento de obligaciones legales. Facilitar datos voluntariamente no equivale a autorizar cualquier uso.</p>
      </> },
      { id: "almacenamiento", title: "Cookies y almacenamiento del navegador", content: <>
        <p>La autenticación utiliza una cookie de sesión protegida frente al acceso de JavaScript. El navegador también conserva información funcional, como posiciones de lectura, borradores de herramientas y la última revisión de una cuenta. Las métricas de descubrimiento emplean un identificador temporal en la memoria de la pestaña, sin una cookie analítica persistente propia.</p>
        <p>Puedes borrar cookies y almacenamiento desde tu navegador. Esto puede cerrar la sesión o eliminar preferencias y borradores. No hay un consentimiento implícito para tecnologías publicitarias: si CRV incorpora tecnologías opcionales que lo requieran, deberá informar y solicitar la autorización correspondiente antes de activarlas.</p>
      </> },
      { id: "terceros", title: "Plataformas externas y proveedores", content: <>
        <p>Los videos, reproductores, imágenes remotas y enlaces pueden comunicar datos técnicos a terceros al cargarse o abrirse. Entre las plataformas enlazadas o integradas pueden estar YouTube/Google, Spotify, Bandcamp, SoundCloud, Deezer, Apple Music y Tidal. Cada proveedor aplica sus propias políticas; cerrar un reproductor no elimina los datos que ya haya recibido.</p>
        <p>Los mensajes enviados por Instagram se tramitan también bajo las condiciones y la política de Meta. No introduzcas información confidencial en esos mensajes. Para acreditar identidad o titularidad, primero acuerda con el equipo el medio y los datos mínimos necesarios.</p>
        <p>CRV utiliza infraestructura de alojamiento y herramientas de investigación, incluidas herramientas de IA. Las consultas que requieren interpretación automatizada y la información pública investigada pueden procesarse mediante los proveedores configurados para esas funciones. Evita incluir datos personales en el buscador. Los proveedores pueden procesar información en otros países; cuando corresponda, deberán aplicarse las garantías exigidas por la legislación pertinente.</p>
        <p>El acceso a datos restringidos se limita al personal y proveedores que lo necesiten para estas finalidades. Podremos comunicar la información mínima necesaria ante una obligación legal válida o para atender incidentes de seguridad y proteger derechos.</p>
      </> },
      { id: "conservacion", title: "Conservación y seguridad", content: <>
        <p>La observabilidad de búsquedas prevé conservar el detalle durante 30 días editoriales y sus agregados diarios durante 180 días. El registro auxiliar de búsquedas sin resultados elimina entradas que llevan 180 días sin repetirse. Estos registros de búsqueda no se asocian a una cuenta ni almacenan la IP del visitante; los controles de seguridad y acceso se gestionan por separado.</p>
        <p>Los datos de acceso se conservan mientras sean necesarios para la cuenta y la seguridad. Los mensajes y solicitudes se mantienen durante su tramitación y, cuando sea necesario, para acreditar su resolución o atender obligaciones legales. Las fuentes, aportes autorizados e historial editorial pueden conservarse a largo plazo para sostener el archivo; los datos personales innecesarios deben retirarse o anonimizarse.</p>
        <p>Aplicamos medidas de control de acceso y protección de sesiones. Ningún sistema ofrece seguridad absoluta. Las copias de seguridad pueden conservar datos hasta su rotación; una restricción o eliminación aceptada debe respetarse también al restaurar una copia. Ante incidentes se adoptarán las medidas y notificaciones que correspondan.</p>
      </> },
      { id: "derechos", title: "Tus solicitudes de privacidad", content: <>
        <p>Puedes solicitar información sobre el tratamiento de tus datos, acceso, rectificación, eliminación, limitación u oposición y, cuando proceda, portabilidad o retirada del consentimiento. <ContactLink>Envía tu solicitud al equipo</ContactLink> con el enlace o dato afectado y la acción que solicitas. Solo pediremos la acreditación proporcional necesaria para evitar solicitudes fraudulentas.</p>
        <p>Las solicitudes se evaluarán conforme a la ley y sus plazos. Una eliminación de datos de cuenta no implica necesariamente borrar hechos públicos de interés documental ni todo el historial; cuando proceda, se eliminarán identificadores o se anonimizarán registros. Si existe un motivo legal de conservación, se explicará. Puedes acudir a la autoridad competente cuando corresponda.</p>
      </> },
      { id: "artistas", title: "Privacidad de artistas y otras personas", content: <>
        <p>Publicamos datos pertinentes a la actividad musical y contrastados con fuentes. No deben incorporarse domicilios particulares, documentos, teléfonos privados, información médica, rumores ni datos familiares ajenos a la obra. Una dirección de contacto solo debe mostrarse si está publicada legítimamente para uso profesional.</p>
        <p>Ser una figura pública no elimina el derecho a la privacidad. Si una ficha expone información privada o presenta un riesgo, puedes pedir su revisión y retirada; preservar la historia musical no justifica conservar datos personales innecesarios.</p>
      </> },
      { id: "menores", title: "Datos de menores y cambios de política", content: <>
        <p>El proyecto no está dirigido a niños y no solicita deliberadamente sus datos. Si eres representante y crees que un menor ha facilitado información personal sin la autorización legal necesaria, <ContactLink>notifícalo al equipo</ContactLink>. Se revisará el caso y se suprimirán o limitarán los datos cuando corresponda. La información pública sobre intérpretes menores requiere especial prudencia.</p>
        <p>Consulta también el <Link to="/terminos#menores">aviso sobre contenido no apto para menores</Link>. Los cambios de esta política se publicarán con su fecha y, si alteran sustancialmente el tratamiento, se comunicarán de manera destacada y se solicitará consentimiento cuando sea exigible.</p>
      </> },
    ],
  },
  copyright: {
    intro: "Promovemos el talento venezolano respetando a quienes crean, interpretan, fotografían, diseñan y producen las obras que documentamos.",
    sections: [
      { id: "titulares", title: "La autoría sigue siendo de sus titulares", content: <>
        <p>CRV preserva música e información con una finalidad cultural, documental y promocional, sin lucrar con el contenido de terceros. No reclama la propiedad de las obras que aparecen en el archivo. Los derechos de autor, de interpretación, de producción fonográfica, de imagen y de marca corresponden a quienes legítimamente los ostenten.</p>
        <p>La presencia de una obra en internet, su antigüedad, la ausencia de un aviso de copyright o nuestra finalidad sin lucro no bastan para autorizar su reproducción. Debe existir autorización, licencia, dominio público comprobado u otra base legal aplicable. No se presume una autorización por falta de respuesta del titular.</p>
      </> },
      { id: "materiales", title: "Portadas, fotos, textos y reproducción musical", content: <>
        <p>Las imágenes y textos deben utilizarse con fundamento y atribuirse cuando corresponda. Documentar una ficha no da permiso para copiar íntegramente biografías, letras, fotografías o publicaciones de otra fuente. Dar crédito es necesario cuando procede, pero no reemplaza un permiso exigible.</p>
        <p>La escucha del catálogo utiliza enlaces y reproductores de plataformas externas. Un reproductor disponible no demuestra por sí solo que quien publicó el video sea titular de todos sus derechos. No deben eludirse bloqueos ni compartirse copias no autorizadas. El material del canal de CRV queda sujeto al mismo respeto de derechos y al procedimiento de revisión de esta página.</p>
        <p>Conservar evidencia o una referencia histórica no implica mantener públicamente una copia que deba retirarse. Un registro puede conservar sus datos documentales aun cuando su imagen o reproducción deje de estar disponible, siempre que exista fundamento para ello.</p>
      </> },
      { id: "reclamos", title: "Solicitar crédito, corrección o retirada", content: <>
        <p>Si eres titular o representante autorizado y detectas un uso que afecta tus derechos, <ContactLink>contacta a CRV por Instagram</ContactLink> con el asunto «Derechos de autor» e incluye:</p>
        <ol>
          <li>Tu nombre o identificación profesional y un medio de respuesta.</li>
          <li>El enlace exacto de CRV y la imagen, texto, grabación o video afectado. Si está en nuestro canal, incluye también su enlace.</li>
          <li>La obra original y la relación que tienes con sus derechos, con evidencia o un enlace que permita comprobarla.</li>
          <li>La medida que solicitas: atribución, rectificación, sustitución, restricción o retirada, y una explicación de buena fe.</li>
        </ol>
        <p>No necesitas publicar documentos personales ni usar una fórmula jurídica específica para iniciar una revisión. El equipo podrá pedir información adicional proporcional y restringir preventivamente el material mientras comprueba el caso. Se comunicará el resultado y se corregirá o retirará el uso cuando corresponda.</p>
        <p>Si el contenido pertenece a una cuenta ajena en una plataforma externa, CRV puede revisar su propio enlace o integración, pero no eliminar el original de esa cuenta. Puedes acudir además al procedimiento de la plataforma. Contactarnos no limita otros recursos legales disponibles ni obliga a renunciar a derechos.</p>
      </> },
      { id: "colaboraciones", title: "Material que aportas a la comunidad", content: <>
        <p>Comparte únicamente lo que puedas autorizar y especifica autoría, procedencia, permisos y cómo deseas que se reconozca el aporte. Para material original, el equipo debe obtener la aceptación de la <Link to="/terminos#aportes">licencia de colaboración</Link> antes de publicarlo. No se presume una cesión total ni una autorización retroactiva.</p>
        <p>Una colaboración voluntaria no da propiedad sobre CRV ni derecho de veto sobre el archivo. Tampoco genera por sí sola remuneración o exclusividad sobre ideas generales o hechos documentales. Esto no elimina los derechos sobre la expresión original de una obra ni permite usar material fuera de lo autorizado.</p>
      </> },
      { id: "reutilizacion", title: "Compartir y reutilizar el archivo", content: <>
        <p>Te animamos a compartir los enlaces de las fichas y a dirigir a otras personas hacia los artistas y sus canales oficiales. Para reproducir material protegido, verifica la licencia específica o solicita autorización a su titular. CRV no puede conceder permisos sobre obras ajenas.</p>
        <p>Los textos originales y la organización del archivo no se ofrecen bajo una licencia abierta general por aparecer en estas páginas. Consulta al equipo si necesitas reutilizar una parte sustancial; los usos permitidos por la ley y los hechos no protegidos conservan su régimen propio.</p>
        <p>Referencia general: <a href="https://www.wipo.int/en/web/copyright/faq-copyright" target="_blank" rel="noreferrer">preguntas frecuentes sobre derecho de autor de la OMPI</a>.</p>
      </> },
    ],
  },
  rules: {
    intro: "Un archivo útil se construye con evidencia, respeto y cuidado por las obras. Estas reglas orientan los aportes y las decisiones editoriales de CRV.",
    sections: [
      { id: "alcance", title: "Qué documentamos", content: <>
        <p>El catálogo reúne rock y otros géneros de la música venezolana, sus artistas, personas, publicaciones, organizaciones y audiovisuales. La inclusión se decide por la vinculación documentada con esa memoria musical, también en la diáspora; no por popularidad, amistad, pagos o preferencias personales.</p>
        <p>Antes de proponer una ficha, busca nombres y alias para evitar duplicados. Distingue artistas con el mismo nombre y proyectos diferentes de una misma persona. Si la identidad no es clara, aporta la evidencia y deja el caso a revisión.</p>
      </> },
      { id: "fuentes", title: "Fuentes antes que suposiciones", content: <>
        <p>Incluye enlaces, créditos de la edición, catálogos, publicaciones o testimonios identificados que respalden cada corrección. Prioriza fuentes oficiales y documentos de la época; contrasta las discrepancias. Un recuerdo puede orientar una investigación, pero debe identificarse como tal.</p>
        <p>No inventes fechas, integrantes, géneros, títulos, duraciones ni créditos. Conserva las incertidumbres y distingue fecha de grabación, publicación y reedición. La IA ayuda a investigar; su respuesta sin evidencia no es una fuente. No copies textos protegidos sin permiso.</p>
      </> },
      { id: "discografia", title: "Discos, versiones y características", content: <>
        <p>Registra las publicaciones musicales según la evidencia de la edición. Tipos y características pueden combinarse: sencillo con remix, demo en vivo o EP instrumental, por ejemplo. Un remix, una interpretación acústica, el carácter instrumental o la cantidad de pistas no determinan por sí solos el tipo de publicación.</p>
        <p>Deluxe, remasterizado y reedición describen versiones y pueden coexistir. No atribuyas a todo el disco una característica de una sola pista ni dividas una ficha sin revisar su contenido. Los filtros de varias categorías requieren que se cumplan todas las seleccionadas.</p>
      </> },
      { id: "audiovisuales", title: "Audiovisuales y marcas de tiempo", content: <>
        <p>Documentales, conciertos, sesiones, videoclips, entrevistas, Shorts y piezas editoriales se registran en Audiovisuales del artista, incluso si combinan varios tipos. La sola existencia de un video o de sus capítulos no justifica crear un disco ni pistas musicales. Una edición musical documentada sí puede tener su disco y su video en Audiovisuales.</p>
        <p>Cada marca de tiempo pertenece a un video concreto, incluido el video de cada CD o lado. El segundo cero es válido. No mezcles capítulos de videos distintos ni calcules inicios sumando duraciones. Vincula títulos o alias exactos a pistas ya existentes; las repeticiones ambiguas y las marcas fuera de duración requieren revisión.</p>
        <p>Una retirada o un bloqueo del video no elimina por sí solo la obra ni su evidencia documental.</p>
      </> },
      { id: "respeto", title: "Respeto, privacidad y contenido permitido", content: <>
        <p>No se permiten acoso, amenazas, discriminación, suplantación, difamación, datos privados, spam, publicidad engañosa ni material ilícito. Los desacuerdos sobre géneros o historia musical deben centrarse en las fuentes y mantener un trato respetuoso.</p>
        <p>Portadas o referencias sensibles pueden documentarse por su contexto artístico e histórico; no se aceptan como excusa para atacar a personas o promover violencia. No compartas material sexual de menores ni contenido que los explote o exponga. Comunica cualquier riesgo al equipo sin redistribuir ese material.</p>
        <p>Respeta los <Link to="/terminos#derechos-de-autor">derechos de autor</Link> y la <Link to="/privacidad#artistas">privacidad de las personas documentadas</Link>.</p>
      </> },
      { id: "revision", title: "Revisión, moderación y desacuerdos", content: <>
        <p>El equipo revisa los aportes antes de incorporarlos o corregirlos. Enviar información no garantiza su publicación ni un plazo de incorporación. Las ediciones autorizadas deben conservar la procedencia y el historial de cambios.</p>
        <p>Los incumplimientos pueden dar lugar a corrección, rechazo, retirada o restricción del acceso, según su gravedad. Si discrepas de una decisión, <ContactLink>solicita una nueva revisión</ContactLink> con la ficha, el cambio concreto y nueva evidencia. No reviertas decisiones repetidamente ni crees duplicados para eludirlas.</p>
      </> },
    ],
  },
  faq: {
    intro: "Respuestas a las dudas más habituales sobre el archivo, sus fuentes y las formas de participar.",
    sections: [
      { id: "que-es", title: "¿Qué es CRV?", content: <p>Coleccionistas de Rock Venezolano es un archivo cultural sin fines de lucro dedicado a preservar información y promover la música venezolana en internet. Relaciona artistas, personas, discos, organizaciones y audiovisuales. Aunque su nombre nace del rock, el catálogo también documenta otros géneros venezolanos.</p> },
      { id: "cuenta", title: "¿Necesito una cuenta o pagar para consultar?", content: <p>No. La consulta es gratuita y no exige registro. El acceso de edición está reservado a personas autorizadas. Si deseas aportar información, usa <Link to="/ayuda#contacto">el canal de contacto</Link>; no necesitas una cuenta de administración.</p> },
      { id: "falta-artista", title: "¿Por qué falta un artista, un disco o un crédito?", content: <p>El archivo está en construcción. Una ausencia puede deberse a información incompleta o a una investigación pendiente y no implica un juicio sobre el valor del artista. Comparte una fuente y el dato concreto siguiendo las <Link to="/ayuda#reglas">reglas de la comunidad</Link>.</p> },
      { id: "corregir", title: "¿Cómo envío una corrección o material antiguo?", content: <p>Envíanos el enlace de la ficha, el dato actual, la corrección propuesta y la fuente que la respalda. Si aportas fotos, textos o digitalizaciones, explica su procedencia y qué permisos tienes. El equipo revisará el material y acordará el permiso y el crédito antes de publicar una colaboración original. Consulta <Link to="/ayuda#aportes">cómo preparar un aporte</Link>.</p> },
      { id: "reproduccion", title: "¿Por qué una pista no se reproduce o un video ya no está?", content: <p>La disponibilidad depende de la plataforma, el país y el titular. Algunas pistas no tienen un video o una marca de tiempo verificados. El catálogo conserva la referencia de la obra aunque el video esté bloqueado o haya desaparecido. Avísanos si conoces un enlace oficial alternativo.</p> },
      { id: "videos", title: "¿Por qué un documental o un concierto aparece en Audiovisuales?", content: <p>Un video no equivale por sí solo a una publicación discográfica. Los documentales, conciertos, sesiones y videoclips se documentan en Audiovisuales del artista. Si existe además una edición musical acreditada, puede tener una ficha de disco. Las marcas de tiempo pertenecen siempre a su video concreto.</p> },
      { id: "diario", title: "¿Cuándo cambian las recomendaciones diarias?", content: <p>A las 00:00 de America/Caracas, según el reloj editorial del servidor. Todos los visitantes comparten la misma fecha editorial, independientemente del país o de la hora de su dispositivo.</p> },
      { id: "fuentes", title: "¿La información es oficial o está libre de errores?", content: <p>No somos representantes de todos los artistas ni un registro oficial de derechos. Contrastamos fuentes, pero pueden existir errores o discrepancias. La investigación puede apoyarse en herramientas automatizadas e IA; su uso no garantiza exactitud. Las correcciones documentadas ayudan a mejorar el archivo.</p> },
      { id: "autor", title: "¿Cómo reclamo una foto, portada, texto o grabación?", content: <p>Consulta <Link to="/terminos#reclamos">el procedimiento de derechos de autor</Link>. Puedes pedir atribución, corrección, restricción o retirada acreditando tu relación con la obra. El fin promocional de CRV no elimina tus derechos ni equivale a un permiso.</p> },
      { id: "ideas", title: "¿Pierdo mi autoría al colaborar? ¿Se pagan las ideas?", content: <p>Conservas la titularidad sobre tu material original. Para publicarlo, CRV debe obtener el permiso descrito en <Link to="/terminos#aportes">los términos de colaboración</Link>. Las ideas generales enviadas para mejorar el proyecto no generan por sí solas regalías, exclusividad ni participación; tampoco impiden reclamar por un uso fuera de lo autorizado.</p> },
      { id: "menores", title: "¿Es un sitio apto para menores?", content: <p>No es un entorno infantil. Puede haber portadas y contenido explícito o perturbador sin una clasificación individual de edad. Los representantes deben valorar y supervisar el acceso. Lee el <Link to="/terminos#menores">aviso para menores y contenido sensible</Link>.</p> },
      { id: "apoyar", title: "¿Cómo apoyo el proyecto y a los músicos?", content: <p>Comparte las fichas, aporta fuentes, ayuda a corregir errores y escucha o compra en los canales oficiales de los artistas. Visita <Link to="/ayuda#apoyar">Apoya el archivo</Link> para conocer otras formas de participar.</p> },
    ],
  },
  help: {
    intro: "Encuentra tu camino por el catálogo y prepara una consulta que nos ayude a resolverla con la información necesaria.",
    sections: [
      { id: "archivo", title: "Sobre el archivo y sus fuentes", content: <>
        <p>CRV reúne fichas relacionadas de artistas, personas, discos, sellos y otras organizaciones. El catálogo abarca rock y otros géneros de la música venezolana y se amplía conforme aparecen documentos y fuentes.</p>
        <p>La información se investiga y contrasta con créditos de publicaciones, canales oficiales, discografías y fuentes musicales, entre ellas Sincopa, MusicBrainz, Discogs, nuestro blog y nuestro canal de YouTube. Citar una fuente no implica afiliación ni permiso para reproducir todas sus obras. Cuando hay discrepancias, se conserva la evidencia y se revisa el dato.</p>
      </> },
      { id: "buscar", title: "Buscar y recorrer el catálogo", content: <>
        <p>Usa el buscador de inicio para localizar nombres, alias, discos y otras relaciones musicales. Desde Catálogo puedes abrir Artistas, Discos, Personas u Organizaciones y aplicar sus filtros. Si una búsqueda falla, prueba otro nombre documentado o consulta la lista de la entidad.</p>
        <p>En los discos, las categorías elegidas se combinan con «Y»: cada resultado debe cumplirlas todas. Puedes quitar una para ampliar la búsqueda. Los filtros se conservan en la URL para compartir el recorrido.</p>
      </> },
      { id: "escuchar", title: "Consultar una ficha y escuchar", content: <>
        <p>Las fichas enlazan discografías, integrantes, créditos y plataformas disponibles. Los videos documentales y demás piezas editoriales se consultan en Audiovisuales del artista. Un enlace externo abre un servicio con sus propias condiciones.</p>
        <p>Cuando hay marcas verificadas, el reproductor de YouTube permite saltar al inicio de una pista. El reproductor compartido puede continuar mientras navegas por CRV; al cerrarlo se detiene. Si falta una marca, no se calcula a partir de las duraciones del disco.</p>
      </> },
      { id: "aportes", title: "Preparar un aporte o una corrección", content: <>
        <ol>
          <li>Busca primero para comprobar si la ficha o el dato ya existen.</li>
          <li>Copia el enlace de CRV y describe un cambio concreto. Para una ficha nueva, indica nombre, relación con la música venezolana y fuentes.</li>
          <li>Añade evidencia: enlace oficial, créditos de la edición, publicación identificada o documentación de la época.</li>
          <li>Para imágenes y textos propios, explica autoría, procedencia, autorización y crédito deseado. El equipo acordará contigo las condiciones antes de publicarlos.</li>
        </ol>
        <p>Consulta las <Link to="/ayuda#reglas">reglas</Link> y los <Link to="/terminos#aportes">términos de colaboración</Link>. No envíes contraseñas, documentos personales ni archivos cuya difusión no puedas autorizar.</p>
      </> },
      { id: "contacto", title: "Contacto, privacidad y derechos", content: <>
        <p>El canal de contacto actual es <ContactLink>@coleccionistasderockvenezolano en Instagram</ContactLink>. Es un servicio externo: se aplican también las condiciones de Meta. No es necesario hacer pública tu solicitud; utiliza el mensaje privado disponible en el perfil.</p>
        <p>Indica el asunto: «Corrección», «Aporte», «Problema técnico», «Privacidad» o «Derechos de autor». Para un fallo técnico, incluye la página, qué intentabas hacer, qué ocurrió y el navegador utilizado; nunca envíes tokens ni contraseñas. El equipo revisa las solicitudes según su naturaleza y urgencia, sin prometer atención inmediata.</p>
        <p>Las solicitudes sobre obras tienen instrucciones en <Link to="/terminos#reclamos">Derechos de autor</Link>; las relativas a datos personales, en <Link to="/privacidad#derechos">Privacidad</Link>. Para riesgos o contenido ilícito que afecte a menores, identifica el enlace sin volver a distribuir el material.</p>
      </> },
      { id: "referencias", title: "Referencias para estas páginas", content: <>
        <p>La organización de esta sección toma como referencia las páginas de <a href="https://www.metal-archives.com/content/pp" target="_blank" rel="noreferrer">privacidad</a>, <a href="https://www.metal-archives.com/content/faq" target="_blank" rel="noreferrer">preguntas frecuentes</a>, <a href="https://www.metal-archives.com/content/support" target="_blank" rel="noreferrer">apoyo</a>, <a href="https://www.metal-archives.com/content/rules" target="_blank" rel="noreferrer">reglas</a> y <a href="https://www.metal-archives.com/content/help" target="_blank" rel="noreferrer">ayuda de Encyclopaedia Metallum</a>. La redacción y las condiciones de CRV son propias y responden a sus funciones; no se trasladan las restricciones de género, cuentas, financiación ni jurisdicción de ese sitio.</p>
        <p>CRV es un proyecto independiente; esta referencia no implica afiliación ni aval.</p>
      </> },
    ],
  },
  support: {
    intro: "La memoria musical se conserva entre muchas personas. Hay formas de ayudar al archivo y al talento venezolano que no requieren dinero.",
    sections: [
      { id: "difundir", title: "Haz que la música llegue más lejos", content: <>
        <p>Comparte enlaces de artistas y discos con una recomendación personal. Visita los perfiles oficiales, escucha mediante sus plataformas, compra sus ediciones y entradas cuando puedas y reconoce a quienes hicieron la música y su arte visual.</p>
        <p>Compartir una ficha con contexto y crédito ayuda a descubrir una trayectoria. Evita redistribuir copias no autorizadas de música, fotos, portadas o textos.</p>
      </> },
      { id: "documentar", title: "Ayuda a completar la historia", content: <>
        <p>Una fecha respaldada, un crédito completo, un enlace oficial o la identificación de una edición pueden resolver un vacío del archivo. Si conservas publicaciones, afiches, entrevistas o documentos, describe qué tienes y de dónde proviene antes de enviar material.</p>
        <p>También puedes avisar de duplicados, errores o enlaces caídos. Sigue la <Link to="/ayuda#aportes">guía de aportes</Link> y las <Link to="/ayuda#reglas">reglas de la comunidad</Link>. Un aporte se evalúa por su respaldo, no por su tamaño ni por la notoriedad del artista.</p>
      </> },
      { id: "colaborar", title: "Ofrece tiempo o conocimientos", content: <>
        <p>Si puedes ayudar con investigación musical, identificación de material, accesibilidad, corrección de textos o desarrollo, <ContactLink>cuéntanos en qué te gustaría colaborar</ContactLink>. El equipo acordará el alcance y los accesos necesarios. No necesitas una cuenta de edición para ofrecer ayuda.</p>
        <p>Las colaboraciones voluntarias no generan por sí solas salario, propiedad sobre el proyecto ni exclusividad. Cualquier encargo remunerado o condición distinta debe acordarse expresamente por escrito. Las obras originales se publican con el permiso y crédito correspondientes.</p>
      </> },
      { id: "transparencia", title: "Apoyo sin comprar decisiones editoriales", content: <>
        <p>Esta página no habilita cobros ni donaciones. Si en el futuro CRV abre una vía de apoyo económico, deberá explicar su destino, responsable y condiciones antes de recibir aportes. No realices pagos a personas que prometan una ficha o una clasificación a cambio de dinero.</p>
        <p>Los apoyos no compran inclusión, prioridad, reseñas favorables ni control sobre el catálogo. La misión sigue siendo preservar la música y su información, sin lucrar con el contenido ajeno.</p>
      </> },
    ],
  },
};

