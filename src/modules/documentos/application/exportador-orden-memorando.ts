/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: exportador-orden-memorando.ts
 * Responsabilidad: Imprimir la Orden de Servicio en formato memorando, dirigido por plantilla.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-15
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DIRIGIDO POR PLANTILLA. Los apartados NO están cableados aquí.
 *
 * La Dirección edita una plantilla única (añadir, quitar, reordenar apartados y cambiar sus
 * textos). Este exportador solo RENDERIZA la lista de apartados que recibe, ya con sus
 * tokens `{{...}}` sustituidos por el servicio. El membrete, el encabezado (memorando, PARA)
 * y el cierre (firma, NUT) son la tramoya institucional; el cuerpo editable son los
 * apartados.
 *
 * Sigue siendo por persona (RN-51): el apartado de tipo `operativos` enumera los operativos
 * de ESA persona, que llegan en `datos.operativos`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type {
  Content,
  ContentTable,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import {
  generarDocumento,
  HAY_LOGOTIPO,
  RUTA_LOGOTIPO,
} from './motor-documento';
import { TINTA } from './identidad-institucional';

/**
 * FUENTE DEL CUERPO. Hoy «Roboto» (la única registrada en `motor-documento.ts`). Para pasar a una
 * SERIF (Times/Tinos, D14): colocar el `.ttf` en `fonts/`, registrarlo en `motor-documento.ts`,
 * copiarlo en el `Dockerfile` y cambiar SOLO esta constante —todo el cuerpo la usa—.
 */
export const FUENTE_CUERPO = 'Roboto';

/**
 * Soporta **negrita** mínima en texto libre: parte en tramos normales y en negrita. Los tokens ya
 * vienen SUSTITUIDOS por el servicio, así que `**{{designado}}**` llega como `**VALOR**` y sale en
 * negrita. Conserva tal cual los caracteres (tildes y ñ): no transforma ni recodifica el texto.
 * Se exporta para poder probar el resaltado y la integridad del texto sin generar el PDF completo.
 */
export function conNegrita(texto: string): string | Content[] {
  if (!texto.includes('**')) return texto;
  return texto
    .split(/\*\*(.+?)\*\*/g)
    .map((tramo, indice) => ({ text: tramo, bold: indice % 2 === 1 }));
}

/**
 * Un valor, o un `[Etiqueta]` con FONDO AMARILLO si el dato está sin completar (D13/D14). Un dato
 * faltante es simplemente uno VACÍO (cadena en blanco): ya no existe el centinela «XXXX». Se ve de
 * un vistazo qué falta antes de emitir en firme.
 *
 * Con `gris` (vista previa de la plantilla, D17) el vacío NO es un faltante sino un ejemplo de lo que
 * cada orden llenará: se pinta como marcador en GRIS, sin el fondo amarillo de alerta.
 */
function textoConFaltante(
  valor: string,
  etiqueta: string,
  gris = false,
): { text: string | Content[]; background?: string; color?: string } {
  // En vista previa, un token de la orden ya sustituido llega como marcador puro «[Etiqueta]»
  // (p. ej. la fecha de emisión dentro de un apartado): también se pinta en gris.
  if (gris && /^\[[^\]]+\]$/.test(valor.trim())) {
    return { text: valor.trim(), color: TINTA.apoyo };
  }
  if (valor.trim() !== '') return { text: conNegrita(valor) };
  return gris
    ? { text: `[${etiqueta}]`, color: TINTA.apoyo }
    : { text: `[${etiqueta}]`, background: TINTA.faltante };
}

/**
 * El número de orden como fragmento de texto: el valor si lo tiene, o un `[placeholder]` GRIS si aún
 * no se ha asignado (D14). A diferencia de los demás vacíos, NO se resalta: su ausencia es normal
 * mientras la orden es Borrador (el número se asigna al quedar Vigente), no un dato pendiente.
 */
function numeroOrdenInline(numero: string): { text: string; color?: string } {
  return numero.trim() === ''
    ? { text: '[N.º se asigna al quedar vigente]', color: TINTA.apoyo }
    : { text: numero };
}

/** Cómo se pinta el contenido de un apartado. */
export type TipoApartado = 'texto' | 'lista' | 'campos' | 'operativos';

/**
 * Un apartado de la plantilla. `contenido` admite tokens `{{...}}` (para `texto`, `lista` y
 * `campos`). El tipo `operativos` ignora el contenido: pinta la tabla de operativos.
 * En `campos`, cada línea es `Etiqueta: valor`. En `lista`, cada línea es una viñeta.
 */
export interface Apartado {
  id: string;
  titulo: string;
  /**
   * Etiqueta de la columna IZQUIERDA de la tabla de 2 columnas (2026-10-01). Separada del título
   * (encabezado del apartado). ADITIVO: si falta, el apartado se pinta como antes (contenido a ancho
   * completo bajo el encabezado); si está, el contenido va a la derecha con la etiqueta a la izquierda.
   */
  etiqueta?: string;
  tipo: TipoApartado;
  contenido: string;
}

/** Un operativo de la persona, tal como se lista en el apartado de operativos. */
export interface OperativoDeOrden {
  identificador: string;
  horario: string;
  zonal: string;
  /**
   * Institución(es) del operativo (2026-10-02): nombres unidos por coma, o cadena vacía si el
   * operativo no tiene ninguna. Opcional: ausente equivale a vacío (celda en blanco, nunca «XXXX»).
   */
  institucion?: string;
}

/** Todo lo que el memorando necesita. Los datos sin completar llegan como cadena vacía (D14). */
export interface DatosOrdenMemorando {
  numeroMemorando: string;
  ciudadFecha: string;
  para: { nombre: string; cargo: string; dependencia: string };
  numeroOrden: string;
  fechaEmision: string;
  direccionResponsable: string;
  /**
   * Teléfono del funcionario DESTINATARIO (RN-34, 2026-10-02): es su propio dato en la orden que
   * recibe —no el de terceros—. Se muestra en el apartado cuarto. Opcional: ausente o vacío deja la
   * celda en blanco (nunca «XXXX»); no es un token requerido de la plantilla, así que no bloquea.
   */
  telefonoFuncionario?: string;
  operativos: OperativoDeOrden[];
  firmante: { nombre: string; cargo: string; dependencia: string };
  nut: string;
  elaboradoPor: string;
  siglasUnidad: string;
  /** El cuerpo editable: apartados YA resueltos (tokens sustituidos por el servicio). */
  apartados: Apartado[];
  /**
   * BORRADOR (E22): la orden aún tiene datos obligatorios sin completar, así que el documento NO es
   * válido todavía. Cuando es `true`, TODAS las páginas llevan la marca de agua diagonal «BORRADOR ·
   * NO VÁLIDO». Una orden Vigente (o la vista previa ya completa) sale sin marca. Opcional: ausente
   * equivale a `false` (sin marca), para no obligar a los llamadores y pruebas que no la usan.
   */
  esBorrador?: boolean;
  /**
   * VISTA PREVIA de la plantilla (D17, 2026-10-05): los datos de la orden llegan vacíos a propósito
   * y se pintan como marcadores GRISES de ejemplo, no como faltantes amarillos. Opcional: ausente
   * equivale a `false` (el documento real conserva el resaltado amarillo).
   */
  modoVistaPrevia?: boolean;
}

// ─────────────────────── Plantilla por omisión ───────────────────────
// Es la que se siembra la primera vez. Transcrita del modelo institucional; las referencias
// variables van como tokens `{{...}}` que el servicio resuelve (vacío → `[Etiqueta]`, nunca «XXXX»).

export const APARTADOS_POR_DEFECTO: Apartado[] = [
  {
    id: 'primero',
    titulo: 'APARTADO PRIMERO',
    tipo: 'campos',
    contenido:
      'Fecha de emisión: {{fechaEmision}}\n' +
      'Dirección/Unidad responsable de la ejecución: {{direccionResponsable}}\n' +
      'Funcionarios responsables: Verificar apartado 4.',
  },
  {
    id: 'segundo',
    titulo: 'APARTADO SEGUNDO',
    etiqueta: 'Fundamento legal y competencia',
    tipo: 'texto',
    // Texto fiel al original (2026-10-02). La dirección responsable, el número y la fecha del
    // memorando de designación y el funcionario designado son DATOS GENERALES de la plantilla
    // (tokens, origen «plantilla»); la negrita `**…**` abarca al token y lo resalta ya resuelto.
    contenido:
      '**{{direccionResponsable}}** de la AMC, es responsable de programar y disponer las ' +
      'inspecciones generales y técnicas, así como de elaborar y ejecutar el cuadro de operativos ' +
      'de control con la participación de los funcionarios instructores.\n' +
      'Mediante Memorando Nro. **{{numeroMemorando}}**, de {{fechaMemorando}}, la Directora ' +
      'Metropolitana de Inspección asignó al **{{designado}}** la validación del cuadro de ' +
      'programación operativa institucional y la emisión de la respectiva orden de servicio.',
  },
  {
    id: 'tercero',
    titulo: 'APARTADO TERCERO',
    etiqueta: 'Objeto de la orden de servicio',
    tipo: 'texto',
    contenido:
      'Garantizar el cumplimiento de la normativa metropolitana en materia de control ' +
      'urbano, licenciamiento y espacio público, mediante la ejecución de inspecciones y ' +
      'operativos en el Distrito Metropolitano de Quito, orientados a la detección y ' +
      'prevención de irregularidades.',
  },
  {
    id: 'cuarto',
    titulo: 'APARTADO CUARTO',
    tipo: 'operativos',
    contenido: '',
  },
  {
    id: 'quinto',
    titulo: 'APARTADO QUINTO',
    etiqueta: 'Disposiciones generales',
    tipo: 'lista',
    contenido:
      'La Dirección Metropolitana de Inspección, mediante la Resolución A002, tiene las ' +
      'facultades de programar y disponer la realización de las inspecciones generales y ' +
      'técnicas en el Distrito Metropolitano de Quito.\n' +
      'El equipo designado deberá ejecutar la acción de control conforme a la normativa y ' +
      'emitir el informe de verificación respectivo.\n' +
      'De ser necesario, se podrán adoptar medidas provisionales o cautelares (suspensión, ' +
      'clausura, retiro, etc.), de acuerdo con las competencias de la AMC.\n' +
      'El incumplimiento de esta orden será considerado falta administrativa.\n' +
      'El tratamiento de la información se rige por el artículo 6 de la Ley Orgánica de ' +
      'Transparencia y Acceso a la Información Pública.\n' +
      'Los funcionarios asignados no podrán ser modificados sin previa autorización.',
  },
];

// ─────────────────────── Estilos y bordes ───────────────────────

/** Borde completo en el azul de filete de la paleta. */
const BORDE_TABLA = {
  hLineWidth: () => 0.6,
  vLineWidth: () => 0.6,
  hLineColor: () => TINTA.filete,
  vLineColor: () => TINTA.filete,
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 4,
  paddingBottom: () => 4,
};

/** Fila de título de apartado: ancho completo, centrada, sobre tinte institucional. */
function filaApartado(titulo: string): TableCell[] {
  return [
    {
      text: titulo,
      colSpan: 2,
      bold: true,
      alignment: 'center',
      fillColor: TINTA.reposo,
      color: TINTA.institucional,
      margin: [0, 1, 0, 1],
    },
    {},
  ];
}

/** Fila etiqueta (izquierda, negrita) → valor (con negrita `**…**` y resaltado de faltantes). */
function filaEtiquetaValor(
  etiqueta: string,
  valor: string,
  gris = false,
): TableCell[] {
  return [
    { text: etiqueta, bold: true, alignment: 'left' },
    { ...textoConFaltante(valor, etiqueta, gris), alignment: 'left' },
  ];
}

/** Fila con contenido a ancho completo (para textos largos y tablas anidadas). */
function filaAncho(contenido: Content): TableCell[] {
  return [{ stack: [contenido], colSpan: 2 } as TableCell, {} as TableCell];
}

/** El apartado de operativos: los de la persona en una tabla IDS · MEMORANDO · MOTIVO. */
function tablaOperativos(datos: DatosOrdenMemorando): Content {
  const encabezado = (texto: string): TableCell => ({
    text: texto,
    bold: true,
    alignment: 'center',
    fillColor: TINTA.reposo,
    color: TINTA.institucional,
  });

  // H30: tabla de DATOS DEL OPERATIVO por cada operativo de la persona: fecha · zonal · funcionario ·
  // teléfono · institución. La fecha es la de emisión (misma para todas las filas). El TELÉFONO es el
  // del propio destinatario (RN-34, su dato en su orden) y la INSTITUCIÓN la del operativo: ambos los
  // trae el servicio. Si no hay dato, la celda queda EN BLANCO (nunca «XXXX»); no son tokens
  // requeridos de la plantilla, así que su ausencia no bloquea ni se resalta en amarillo.
  const filasOperativo: TableCell[][] = datos.operativos.map((operativo) => [
    { text: datos.fechaEmision, alignment: 'left' },
    { text: operativo.zonal, alignment: 'left' },
    {
      ...textoConFaltante(
        datos.para.nombre,
        'Funcionario',
        datos.modoVistaPrevia,
      ),
      alignment: 'left',
    },
    { text: datos.telefonoFuncionario ?? '', alignment: 'left' },
    { text: operativo.institucion ?? '', alignment: 'left' },
  ]);
  if (filasOperativo.length === 0) {
    filasOperativo.push([
      {
        text: 'Sin operativos asignados en la jornada.',
        colSpan: 5,
        alignment: 'center',
        italics: true,
      },
      {},
      {},
      {},
      {},
    ]);
  }
  const tablaDatosOperativo: ContentTable = {
    table: {
      headerRows: 1,
      widths: ['auto', '*', '*', 'auto', '*'],
      body: [
        [
          encabezado('Fecha'),
          encabezado('Zonal'),
          encabezado('Funcionario'),
          encabezado('Teléfono'),
          encabezado('Institución'),
        ],
        ...filasOperativo,
      ],
    },
    layout: BORDE_TABLA,
    margin: [0, 4, 0, 6],
  };

  const filas: TableCell[][] = datos.operativos.map((operativo) => [
    { text: operativo.identificador, alignment: 'left' },
    // MEMORANDO U OFICIO y MOTIVO EN BLANCO (decisión del negocio, 2026-09-15).
    { text: '' },
    { text: '' },
  ]);

  if (filas.length === 0) {
    filas.push([
      {
        text: 'Sin operativos asignados en la jornada.',
        colSpan: 3,
        alignment: 'center',
        italics: true,
      },
      {},
      {},
    ]);
  }

  const tabla: ContentTable = {
    table: {
      headerRows: 1,
      widths: ['*', '*', '*'],
      body: [
        [
          encabezado('IDS'),
          encabezado('MEMORANDO U OFICIO'),
          encabezado('MOTIVO'),
        ],
        ...filas,
      ],
    },
    layout: BORDE_TABLA,
    margin: [0, 4, 0, 0],
  };

  return { stack: [tablaDatosOperativo, tabla] };
}

/** Convierte un apartado en las filas de la tabla del documento. */
function filasDeApartado(
  apartado: Apartado,
  datos: DatosOrdenMemorando,
): TableCell[][] {
  const filas: TableCell[][] = [filaApartado(apartado.titulo)];
  // ETIQUETA de la columna izquierda (2026-10-01): si está, el contenido va a la derecha.
  const etiqueta = apartado.etiqueta?.trim() ?? '';

  if (apartado.tipo === 'operativos') {
    filas.push(filaAncho(tablaOperativos(datos)));
    return filas;
  }

  if (apartado.tipo === 'lista') {
    const puntos = apartado.contenido
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea.length > 0);
    filas.push(
      etiqueta
        ? [
            { text: etiqueta, bold: true, alignment: 'left' },
            { ul: puntos, alignment: 'justify' },
          ]
        : filaAncho({ ul: puntos, alignment: 'justify' }),
    );
    return filas;
  }

  if (apartado.tipo === 'campos') {
    for (const linea of apartado.contenido.split('\n')) {
      if (!linea.trim()) continue;
      const separador = linea.indexOf(':');
      if (separador === -1) {
        filas.push(filaAncho({ text: linea, alignment: 'left' }));
      } else {
        filas.push(
          filaEtiquetaValor(
            linea.slice(0, separador).trim(),
            linea.slice(separador + 1).trim(),
            datos.modoVistaPrevia,
          ),
        );
      }
    }
    return filas;
  }

  // 'texto'
  filas.push(
    etiqueta
      ? filaEtiquetaValor(etiqueta, apartado.contenido, datos.modoVistaPrevia)
      : filaAncho({
          text: conNegrita(apartado.contenido),
          alignment: 'justify',
        }),
  );
  return filas;
}

// ─────────────────────── Documento ───────────────────────

/**
 * Cabecera de página (membrete): el logotipo institucional —el bloque completo Agencia · escudo ·
 * Quito— repetido en cada hoja, SELLADO con un filete institucional debajo.
 *
 * EL FILETE (2026-09-22) es lo que convierte el logotipo suelto en un membrete de carta oficial,
 * como el documento de resolución: cierra la banda superior en cada página. El logo mide 44.7 pt a
 * 200 de ancho, así que el membrete cabe holgado en el margen superior (92 pt) sin pisar el cuerpo.
 */
function membrete(): Content {
  const marca: Content = HAY_LOGOTIPO()
    ? {
        image: RUTA_LOGOTIPO,
        width: 200,
        alignment: 'center',
        margin: [0, 16, 0, 6],
      }
    : {
        text: 'AGENCIA METROPOLITANA DE CONTROL',
        bold: true,
        alignment: 'center',
        color: TINTA.institucional,
        margin: [0, 22, 0, 6],
      };

  // Filete a lo ancho del cuerpo (56 pt de margen a cada lado, igual que la caja del documento).
  const filete: Content = {
    table: {
      widths: ['*'],
      body: [[{ text: '', border: [false, false, false, true] }]],
    },
    layout: {
      hLineWidth: () => 0.8,
      hLineColor: () => TINTA.filete,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 0,
    },
    margin: [56, 0, 56, 0],
  };

  return { stack: [marca, filete] };
}

/**
 * El nombre del firmante SIN TÍTULO y en MAYÚSCULAS, para la línea «Firmado electrónicamente por:»
 * (2026-10-02). Quita los tratamientos iniciales —abreviaturas que terminan en punto, como «Mgs.»,
 * «Ing.», «Ab.», «Dr.», «Lic.», «Sr.», «Sra.»— y deja solo el nombre. Si tras quitarlos no queda
 * nada (el firmante era solo un título), usa el texto completo en mayúsculas.
 */
function nombreSinTitulo(nombre: string): string {
  const limpio = nombre.trim();
  if (limpio === '') return '';
  const palabras = limpio.split(/\s+/);
  let inicio = 0;
  while (inicio < palabras.length && /\.$/.test(palabras[inicio])) inicio += 1;
  const resto = palabras.slice(inicio).join(' ');
  return (resto || limpio).toUpperCase();
}

/** Compone el memorando y lo devuelve completo. */
export async function exportarOrdenMemorando(
  datos: DatosOrdenMemorando,
): Promise<Buffer> {
  const cuerpoTabla: TableCell[][] = [
    [
      {
        text: ['ORDEN DE SERVICIO Nro. ', numeroOrdenInline(datos.numeroOrden)],
        colSpan: 2,
        bold: true,
        alignment: 'center',
        fillColor: TINTA.reposo,
        color: TINTA.institucional,
      },
      {},
    ],
    ...datos.apartados.flatMap((apartado) => filasDeApartado(apartado, datos)),
  ];

  const content: Content[] = [
    {
      // «Quito, D.M., <fecha>» a la derecha. SIN la línea «Memorando Nro.» en el encabezado (H29):
      // el número de memorando sigue disponible como token {{numeroMemorando}} dentro de los apartados.
      ...textoConFaltante(
        datos.ciudadFecha,
        'Ciudad y fecha',
        datos.modoVistaPrevia,
      ),
      bold: true,
      alignment: 'right',
      margin: [0, 4, 0, 14],
    },
    {
      columns: [
        { width: 70, text: 'PARA:', bold: true },
        {
          width: '*',
          // H29: PARA con nombre, cargo y dependencia EN NEGRITA. Los vacíos se resaltan (nunca XXXX).
          stack: [
            {
              ...textoConFaltante(
                datos.para.nombre,
                'Nombre',
                datos.modoVistaPrevia,
              ),
              bold: true,
            },
            {
              ...textoConFaltante(
                datos.para.cargo,
                'Cargo',
                datos.modoVistaPrevia,
              ),
              bold: true,
            },
            {
              ...textoConFaltante(
                datos.para.dependencia,
                'Dependencia',
                datos.modoVistaPrevia,
              ),
              bold: true,
            },
          ],
        },
      ],
      margin: [0, 0, 0, 8],
    },
    {
      columns: [
        { width: 70, text: 'ASUNTO:', bold: true },
        {
          width: '*',
          // La dirección del ASUNTO sale de la plantilla del Director (punto 7, 2026-10-05): ya no va
          // cableada. Si falta, se resalta como cualquier dato pendiente.
          text: [
            textoConFaltante(
              datos.direccionResponsable,
              'Dirección responsable',
              datos.modoVistaPrevia === true,
            ),
            ' - Orden de Servicio Nro. ',
            numeroOrdenInline(datos.numeroOrden),
          ],
        },
      ],
      margin: [0, 0, 0, 14],
    },
    {
      table: { widths: [200, '*'], body: cuerpoTabla },
      layout: BORDE_TABLA,
    },
    { text: 'Atentamente,', margin: [0, 22, 0, 24] },
    { text: '____________________________________', alignment: 'center' },
    /*
      FIRMA ELECTRÓNICA. El firmante sale de los DATOS GENERALES de la plantilla (2026-10-02): nombre,
      cargo y dependencia. Hoy SIN QR (D2, aplazado por decisión del usuario): solo el texto «Firmado
      electrónicamente por: NOMBRE» (nombre sin título, en mayúsculas), y debajo el nombre con su
      título, el cargo y la DEPENDENCIA en mayúsculas. Cuando se autorice la librería `qrcode`, el QR
      iría AQUÍ, a la izquierda de este bloque como `{ image: ... }` (pdfmake ya embebe imágenes por
      dataURL). Si falta el nombre, se resalta en amarillo (nunca XXXX).
    */
    {
      text: `Firmado electrónicamente por: ${nombreSinTitulo(
        datos.firmante.nombre,
      )}`,
      alignment: 'center',
      fontSize: 8,
      color: TINTA.apoyo,
      margin: [0, 2, 0, 0],
    },
    {
      ...textoConFaltante(
        datos.firmante.nombre,
        'Firmante',
        datos.modoVistaPrevia,
      ),
      bold: true,
      alignment: 'center',
    },
    { text: datos.firmante.cargo, alignment: 'center' },
    {
      text: datos.firmante.dependencia.toUpperCase(),
      alignment: 'center',
      margin: [0, 0, 0, 16],
    },
    { text: `NUT: ${datos.nut}`, margin: [0, 0, 0, 12] },
    {
      table: {
        widths: ['*', 120, 90],
        body: [
          [
            {
              text: 'Acción',
              bold: true,
              alignment: 'center',
              fillColor: TINTA.reposo,
              color: TINTA.institucional,
            },
            {
              text: 'Siglas Unidad',
              bold: true,
              alignment: 'center',
              fillColor: TINTA.reposo,
              color: TINTA.institucional,
            },
            {
              text: 'Fecha',
              bold: true,
              alignment: 'center',
              fillColor: TINTA.reposo,
              color: TINTA.institucional,
            },
          ],
          [
            { text: `Elaborado por: ${datos.elaboradoPor}` },
            { text: datos.siglasUnidad, alignment: 'center' },
            datos.modoVistaPrevia
              ? {
                  ...textoConFaltante('', 'Fecha de emisión', true),
                  alignment: 'center',
                }
              : { text: datos.fechaEmision, alignment: 'center' },
          ],
        ],
      },
      layout: BORDE_TABLA,
      margin: [0, 4, 0, 0],
    },
  ];

  const definicion: TDocumentDefinitions = {
    pageSize: 'A4',
    pageMargins: [56, 92, 56, 56],
    defaultStyle: { font: FUENTE_CUERPO, fontSize: 9 },
    // MARCA DE AGUA de Borrador (E22): diagonal, en TODAS las páginas, tenue para no tapar el texto.
    // Solo si la orden es Borrador (datos obligatorios sin completar); una Vigente sale limpia.
    ...(datos.esBorrador
      ? {
          watermark: {
            text: 'BORRADOR · NO VÁLIDO',
            color: TINTA.apoyo,
            opacity: 0.3,
            bold: true,
            italics: false,
          },
        }
      : {}),
    info: {
      title: `Orden de servicio ${datos.numeroOrden || '(sin número)'}`,
      author: 'Agencia Metropolitana de Control',
      subject: 'Orden de servicio (memorando)',
    },
    header: () => membrete(),
    footer: (paginaActual: number, totalPaginas: number) => ({
      columns: [
        {
          width: '*',
          text: 'www.agenciadecontrol.quito.gob.ec  ·  Calles Alpallana E6-113 y Francisco Flor  ·  02395 2300',
          fontSize: 7,
          color: TINTA.apoyo,
          margin: [56, 0, 0, 0],
        },
        {
          width: 60,
          text: `${paginaActual}/${totalPaginas}`,
          fontSize: 7,
          color: TINTA.apoyo,
          alignment: 'right',
          margin: [0, 0, 56, 0],
        },
      ],
    }),
    content,
  };

  return generarDocumento(definicion);
}
