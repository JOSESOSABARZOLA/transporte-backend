/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: exportador-matriz.ts
 * Responsabilidad: Imprimir la matriz como documento institucional.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HORIZONTAL, CON BANNERS Y FIRMAS, SIN NINGÚN CONTROL DE INTERFAZ.
 *
 * Es el caso 8 del plan, y no es una preferencia estética: el documento **se archiva y se
 * firma**. Una captura de la pantalla llevaría botones de exportar y de editar, columnas
 * de acciones y filtros, que en un papel firmado no significan nada.
 *
 * Por eso el PDF se compone desde los datos y no desde la vista: aquí no existe la
 * columna «ACCIONES» de FASE5 §4.3 porque no hay de dónde sacarla.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SE USA `pdfkit`, QUE YA ESTABA INSTALADO. La guía lo lista entre las dependencias
 * presentes (§4.1) junto con `pdf-lib` y `pdfmake`, así que no se agrega ninguna. Entre
 * las tres se eligió `pdfkit` porque **trae sus propias fuentes**: `pdfmake` exige
 * registrar archivos `.ttf` que habría que empaquetar en la imagen del contenedor, y un
 * documento que falla en producción por una fuente ausente es peor que uno más sobrio.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CON LOGOTIPO DESDE EL 2026-08-25. PV-30 CERRADO.
 *
 * Hasta entonces se imprimía la identificación **en texto**, y este comentario explicaba
 * por qué: `src/assets/LogoAmc.jpeg` existía desde la línea base pero eran **70 bytes, un
 * PNG transparente de 1×1 con extensión `.jpeg`**. Un archivo con el nombre y la ruta
 * correctos que no era lo que aparentaba; usarlo sin mirarlo habría impreso un píxel
 * invisible donde va el membrete de un documento oficial.
 *
 * Ya está el real, entregado por la institución: `src/assets/logo-amc.png`, el bloque
 * completo —Agencia · escudo · Quito Alcaldía Metropolitana—. El membrete vive en
 * `identidad-institucional.ts`, compartido con la orden de servicio, y **si el archivo
 * faltara el documento sigue saliendo** con el membrete de texto de antes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import PDFDocument from 'pdfkit';

import type {
  MatrizCompuesta,
  SeccionMatriz,
} from './matriz-consolidada.service';
import type { OperativoDeMatriz } from '../infrastructure/matriz.repository';
import { textoDeTipoControl } from './tipo-control-texto';
import { comoHoraInstitucional } from './reglas-matriz';
import {
  imprimirFilete,
  imprimirMembrete,
  TINTA,
} from './identidad-institucional';

/** A4 apaisado, en puntos. */
const MARGEN = 28;
const ANCHO_UTIL = 842 - MARGEN * 2;

/**
 * Las diez columnas de FASE5 §4.3, sin la de acciones.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * REPARTO CORREGIDO EL 2026-08-25. OBSERVACIONES tenía **40 puntos**.
 *
 * Era la columna más estrecha del documento para el único campo de texto libre que
 * existe: su propio título partía en dos renglones —«OBSERVA / CIONES»— y el contenido
 * salía cortado con puntos suspensivos en cuanto pasaba de tres palabras. Un dato que se
 * imprime cortado es un dato que no está.
 *
 * Los anchos siguen sumando exactamente `ANCHO_UTIL`: lo que gana OBSERVACIONES sale de
 * las columnas cuyo contenido es de longitud **acotada y conocida** —el horario son once
 * caracteres, la placa ocho, las siglas de institución tres o cuatro—, no de las que
 * llevan nombres propios.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const COLUMNAS: { titulo: string; ancho: number }[] = [
  { titulo: 'IDENTIFICADOR', ancho: 96 },
  { titulo: 'HORARIO', ancho: 58 },
  { titulo: 'PERSONAL', ancho: 108 },
  { titulo: 'TELÉFONO', ancho: 50 },
  { titulo: 'ZONAL', ancho: 68 },
  { titulo: 'PUNTO', ancho: 78 },
  { titulo: 'TIPO', ancho: 74 },
  { titulo: 'INST.', ancho: 46 },
  { titulo: 'CONDUCTOR', ancho: 78 },
  { titulo: 'PLACA', ancho: 44 },
  { titulo: 'OBSERVACIONES', ancho: 86 },
];

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAS DOS COLUMNAS QUE SE PARTEN POR PERSONA. El resto de la fila las abarca.
 *
 * Se guardan por índice y no por título porque el dibujo es posicional: `imprimirFila`
 * recorre `COLUMNAS` acumulando `x`, y necesita saber en qué par de posiciones **no**
 * escribir el valor del operativo. Si alguien reordena `COLUMNAS` sin tocar esto, el
 * documento sale con los nombres en la columna del zonal, así que hay una prueba que lo
 * comprueba por el título.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const COLUMNA_PERSONAL = 2;
const COLUMNA_TELEFONO = 3;

/** Ancho del logotipo en la matriz. Apaisado: cabe sin quitar altura a la tabla. */
const ANCHO_LOGO = 196;

const ALTO_FILA = 16;
const ALTO_BANNER = 20;

/**
 * Relleno vertical de una celda: el texto arranca a 5 pt del borde superior y deja ~4 pt abajo.
 * La altura de cada celda es `heightOfString + RELLENO_VERTICAL`, nunca menos que `ALTO_FILA`.
 */
const RELLENO_VERTICAL = 9;

/** Compone el documento y lo devuelve completo, listo para responder. */
export async function exportarMatriz(matriz: MatrizCompuesta): Promise<Buffer> {
  const documento = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: MARGEN,
    info: {
      Title: `Matriz Consolidada ${matriz.cuadro.ordenTrabajo}`,
      Author: 'Agencia Metropolitana de Control',
      Subject: `Cuadro de Colores Operativo · ${matriz.fechaNatural}`,
    },
  });

  const partes: Buffer[] = [];
  documento.on('data', (parte: Buffer) => partes.push(parte));

  const terminado = new Promise<Buffer>((resolver) => {
    documento.on('end', () => resolver(Buffer.concat(partes)));
  });

  imprimirCabecera(documento, matriz);

  for (const seccion of matriz.secciones) {
    imprimirSeccion(documento, seccion);
  }

  imprimirFirmas(documento);

  documento.end();
  return terminado;
}

// ─────────────────────────── Cabecera ───────────────────────────

function imprimirCabecera(
  documento: PDFKit.PDFDocument,
  matriz: MatrizCompuesta,
): void {
  /*
    ═══════════════════════════════════════════════════════════════════════════════
    EL LOGOTIPO A LA IZQUIERDA Y EL DOCUMENTO A SU DERECHA. 2026-08-25.

    Apaisado hay ancho de sobra, así que el membrete no roba altura a la tabla: ocupa la
    banda que antes estaba vacía a la derecha del titular. Y el titular de texto se va,
    porque el bloque institucional **ya dice** el nombre de la Agencia.
    ═══════════════════════════════════════════════════════════════════════════════
  */
  const finLogo = imprimirMembrete(documento, {
    ancho: ANCHO_LOGO,
    x: MARGEN,
    y: MARGEN,
    respaldo: 'AGENCIA METROPOLITANA DE CONTROL',
  });

  const izquierda = MARGEN + ANCHO_LOGO + 24;

  documento
    .font('Helvetica-Bold')
    .fontSize(12)
    .fillColor(TINTA.institucional)
    .text('MATRIZ CONSOLIDADA DEL DÍA', izquierda, MARGEN + 4, {
      characterSpacing: 1.6,
    });

  documento
    .font('Helvetica')
    .fontSize(8.5)
    .fillColor(TINTA.apoyo)
    .text('Dirección Nacional de Planificación', izquierda, documento.y + 2);

  documento
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(TINTA.cuerpo)
    .text(
      `${matriz.cuadro.ordenTrabajo} · ${matriz.fechaNatural} · Semana ${matriz.cuadro.nroSemana} de ${matriz.cuadro.anioSemana} · ${matriz.cuadro.estado}`,
      izquierda,
      documento.y + 4,
    );

  // El bloque más alto manda: con logotipo es él, sin logotipo es el texto.
  documento.y = Math.max(documento.y, finLogo);

  documento.x = izquierda;

  const resumen = [
    `${matriz.totales.operativos} operativos`,
    `${matriz.totales.alertas} alertas`,
    matriz.flota
      ? `flota ${matriz.flota.requeridos}/${matriz.flota.declarados}${matriz.flota.hayAdvertencia ? ' (excedida)' : ''}`
      : 'flota sin declarar',
  ];

  if (matriz.totales.formulariosSinCarga > 0) {
    resumen.push(
      `${matriz.totales.formulariosSinCarga} formularios sin información`,
    );
  }

  /*
    LOS TOTALES SON DATO CLAVE, NO NOTA AL PIE. Mismo texto exacto que antes; sube de peso,
    tamaño y al azul de marca para que la cifra del día salte a la vista. No se altera el
    contenido: sigue siendo `resumen.join`.
  */
  documento
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(TINTA.institucional)
    .text(resumen.join('  ·  '), izquierda, documento.y + 3);

  imprimirFilete(documento, MARGEN, documento.y + 10, ANCHO_UTIL, 1);
  documento.x = MARGEN;
  documento.y += 18;
}

// ─────────────────────────── Secciones ───────────────────────────

function imprimirSeccion(
  documento: PDFKit.PDFDocument,
  seccion: SeccionMatriz,
): void {
  /*
    ═══════════════════════════════════════════════════════════════════════════════
    SE AGRUPA POR LOTE (`grupoRegistro`) COMO EN LA PANTALLA. 2026-09-22.

    Un registro del 8 —o una patrulla del 5/6— se reparte en VARIOS operativos (uno por
    persona/código) que comparten `oper_grupo_registro`. La pantalla los pinta como UN bloque
    (identificador por código, personal por persona con «(n)», el resto fusionado) y raya
    gris/blanco POR BLOQUE, no por código suelto. El PDF tiene que salir igual: se agrupan aquí
    y la cebra alterna por índice de BLOQUE. Un operativo sin lote es su propio bloque de uno.
    ═══════════════════════════════════════════════════════════════════════════════
  */
  const bloques = agruparPorLote(seccion.operativos);

  /*
    ALTURA VARIABLE DESDE EL 2026-08-27. Un operativo ya no ocupa una fila: ocupa una por
    persona (o por código, en un lote). Estimarla de menos mandaría a otra página secciones que
    caben, y —peor— dejaría a mitad de página las que no.
  */
  const alto =
    ALTO_BANNER +
    ALTO_FILA +
    (bloques.length === 0
      ? ALTO_FILA
      : bloques.reduce(
          (suma, bloque) => suma + altoDeBloque(documento, bloque),
          0,
        ));

  exigirEspacio(documento, alto);
  imprimirBanner(documento, seccion);

  if (seccion.operativos.length === 0) {
    imprimirVacio(documento, seccion);
    return;
  }

  imprimirEncabezadoDeTabla(documento);

  // Vienen ya ordenados: lo planificado primero, los adicionales detrás. Ver
  // `MatrizRepository.listarOperativos`.
  let bandaImpresa = false;

  bloques.forEach((bloque, indiceBloque) => {
    exigirEspacio(documento, altoDeBloque(documento, bloque) + ALTO_FILA);

    // La banda se imprime UNA vez, justo antes del primer adicional de la sección.
    if (bloque[0].origenId !== null && !bandaImpresa) {
      imprimirBandaDeAdicionales(documento);
      bandaImpresa = true;
    }

    // CEBRA POR BLOQUE: par = gris, como `bandaGris = indiceGrupo % 2 === 0` de la pantalla.
    const bandaGris = indiceBloque % 2 === 0;

    if (bloque[0].grupoRegistro) {
      imprimirBloque(documento, bloque, bandaGris);
    } else {
      imprimirFila(documento, bloque[0], bandaGris);
    }
  });

  documento.moveDown(0.4);
}

/**
 * Agrupa los operativos por lote (`grupoRegistro`), en orden de aparición: los de un mismo
 * registro del 8 (o patrulla 5/6) quedan juntos en un bloque; los que no tienen lote —los
 * formularios normales y los adicionales— quedan cada uno en su bloque de uno.
 */
function agruparPorLote(
  operativos: OperativoDeMatriz[],
): OperativoDeMatriz[][] {
  const bloques: OperativoDeMatriz[][] = [];
  const indicePorLote = new Map<string, number>();

  for (const operativo of operativos) {
    const lote = operativo.grupoRegistro;
    if (lote) {
      const existente = indicePorLote.get(lote);
      if (existente !== undefined) {
        bloques[existente].push(operativo);
        continue;
      }
      indicePorLote.set(lote, bloques.length);
    }
    bloques.push([operativo]);
  }

  return bloques;
}

/** La altura del bloque: la de sus códigos si es un lote, o la del operativo si está solo. */
function altoDeBloque(
  documento: PDFKit.PDFDocument,
  bloque: OperativoDeMatriz[],
): number {
  return bloque[0].grupoRegistro
    ? medirBloque(documento, bloque).alto
    : medirFila(documento, bloque[0]).alto;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA FRANJA QUE SEPARA LO PLANIFICADO DE LO DISPUESTO POR URGENCIA. 2026-08-20.
 *
 * Desde que la Dirección puede sumar un adicional a un cuadro ya cerrado, **existen dos
 * versiones del mismo documento firmado**. Quien compare la matriz de las 16H00 con la de
 * las 18H00 tiene que ver qué se añadió, y no deducirlo de que un identificador empiece
 * por `OCAPMO` en vez de por `OCPMO`.
 *
 * SE RESUELVE CON UNA FRANJA Y NO EN LA COLUMNA DEL IDENTIFICADOR, porque no cabe: son
 * 108 puntos, y `OCAPMO-001-21-AGO-2026` ya ocupa tres cuartas partes. La de
 * observaciones son 40. Ensanchar una columna estrecharía otra, y las once columnas y sus
 * anchos son el diseño aprobado en FASE5 §4.3.
 *
 * La franja no altera ninguna columna: ocupa una fila propia, entre las dos series.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function imprimirBandaDeAdicionales(documento: PDFKit.PDFDocument): void {
  const y = documento.y;

  documento.rect(MARGEN, y, ANCHO_UTIL, ALTO_FILA).fill('#E8E8E8');

  documento
    .font('Helvetica-Bold')
    .fontSize(6.5)
    .fillColor('#000000')
    .text(
      'OPERATIVOS ADICIONALES · dispuestos por urgencia, fuera de la planificación de la jornada',
      MARGEN + 4,
      y + 5,
      { width: ANCHO_UTIL - 8, lineBreak: false },
    );

  documento.y = y + ALTO_FILA;
}

/** El banner lleva **el color del formulario**, que viene de la base (RN-21). */
function imprimirBanner(
  documento: PDFKit.PDFDocument,
  seccion: SeccionMatriz,
): void {
  const y = documento.y;

  documento
    .rect(MARGEN, y, ANCHO_UTIL, ALTO_BANNER)
    .fill(seccion.formulario.colorFondo);

  documento
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .fillColor(contrasteSobre(seccion.formulario.colorFondo))
    .text(
      `${seccion.formulario.numero}. ${seccion.formulario.nombre}`,
      MARGEN + 6,
      y + 6,
      { width: ANCHO_UTIL - 260, lineBreak: false },
    );

  documento
    .font('Helvetica')
    .fontSize(7.5)
    .text(
      `${seccion.responsable} · ${seccion.operativos.length} ${seccion.operativos.length === 1 ? 'operativo' : 'operativos'}`,
      MARGEN + ANCHO_UTIL - 254,
      y + 7,
      { width: 248, align: 'right', lineBreak: false },
    );

  documento.fillColor('#000000');
  documento.y = y + ALTO_BANNER;
}

/** RN-53 y RN-54, o el simple «sin operativos» cuando la ventana sigue abierta. */
function imprimirVacio(
  documento: PDFKit.PDFDocument,
  seccion: SeccionMatriz,
): void {
  const y = documento.y;

  documento.rect(MARGEN, y, ANCHO_UTIL, ALTO_FILA * 2).fill('#f7f7f7');

  if (seccion.evidencia) {
    documento
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#8a6d3b')
      .text(seccion.evidencia.leyenda, MARGEN + 8, y + 5);

    documento
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `Responsable: ${seccion.evidencia.responsable}${
          seccion.evidencia.horaCierre
            ? ` · cierre ${seccion.evidencia.horaCierre}`
            : ''
        }`,
        MARGEN + 8,
        y + 17,
      );
  } else {
    documento
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor('#666666')
      .text(
        'Sin operativos registrados. La ventana de carga sigue abierta.',
        MARGEN + 8,
        y + 11,
      );
  }

  documento.fillColor('#000000');
  documento.y = y + ALTO_FILA * 2 + 6;
}

function imprimirEncabezadoDeTabla(documento: PDFKit.PDFDocument): void {
  const y = documento.y;
  let x = MARGEN;

  documento.rect(MARGEN, y, ANCHO_UTIL, ALTO_FILA).fill(TINTA.reposo);
  documento.font('Helvetica-Bold').fontSize(7).fillColor(TINTA.institucional);

  for (const columna of COLUMNAS) {
    documento.text(columna.titulo, x + 4, y + 5, {
      width: columna.ancho - 7,
      characterSpacing: 0.2,
      lineBreak: false,
    });
    x += columna.ancho;
  }

  // Filete bajo la cabecera: la separa del cuerpo sin engordar la fila.
  documento
    .moveTo(MARGEN, y + ALTO_FILA)
    .lineTo(MARGEN + ANCHO_UTIL, y + ALTO_FILA)
    .strokeColor(TINTA.filete)
    .lineWidth(0.6)
    .stroke();

  documento.y = y + ALTO_FILA;
}

function imprimirFila(
  documento: PDFKit.PDFDocument,
  operativo: OperativoDeMatriz,
  bandaGris: boolean,
): void {
  const y = documento.y;
  let x = MARGEN;

  const personas = personasDe(operativo);
  const { alto, altosPersona } = medirFila(documento, operativo);

  /*
    CEBRA TENUE. Alterna el fondo POR BLOQUE (la decide `imprimirSeccion`) para seguir las
    once columnas a lo ancho. Se pinta el bloque ENTERO del operativo (todas sus personas), así
    no rompe el efecto de celda combinada. Va antes que el texto; el `fillColor` se repone abajo.
  */
  if (bandaGris) {
    documento.rect(MARGEN, y, ANCHO_UTIL, alto).fill(TINTA.cebra);
  }

  const celdas = celdasCompartidas(operativo);

  documento.font('Helvetica').fontSize(6.5).fillColor('#000000');

  /** Donde empieza cada columna, para poder volver a las dos que se parten. */
  const inicioDe: number[] = [];

  for (const [posicion, columna] of COLUMNAS.entries()) {
    inicioDe[posicion] = x;
    const texto = celdas[posicion];

    /*
      SIN RECORTE (2026-09-22). Antes se pasaba `height: ALTO_FILA`, `ellipsis` y
      `lineBreak: false`: un nombre o una observación que no cabía se cortaba con «…» o
      cruzaba la raya de abajo, y el dato se perdía. Ahora el texto envuelve en su columna y
      la fila crece (ver `medirFila`), así que todo el dato queda visible.
    */
    if (texto !== null) {
      documento.text(texto, x + 3, y + 5, { width: columna.ancho - 6 });
    }

    x += columna.ancho;
  }

  /*
    ═══════════════════════════════════════════════════════════════════════════════
    UN RENGLON POR PERSONA, con su telefono al lado. 2026-08-27.

    Antes esta celda decia `APELLIDO +2`: el documento firmado nombraba a una persona de
    tres y no daba ningun telefono. Es la columna 3 del cuadro segun FASE2 16.1 —PERSONAL
    ASIGNADO / TELEFONO— y RF-015 la pide con prioridad alta; HU-07 explica para que.

    Cada renglón de persona mide lo que su nombre necesita (uno o dos renglones); el
    siguiente arranca debajo. Las demas celdas se imprimen una sola vez arriba y el filete
    de cierre va al final del grupo, que es lo que produce el efecto de celda combinada.
    ═══════════════════════════════════════════════════════════════════════════════
  */
  let yPersona = y;
  personas.forEach((persona, posicion) => {
    documento.text(
      persona.nombre,
      inicioDe[COLUMNA_PERSONAL] + 3,
      yPersona + 5,
      {
        width: COLUMNAS[COLUMNA_PERSONAL].ancho - 6,
      },
    );

    documento.text(
      persona.telefono,
      inicioDe[COLUMNA_TELEFONO] + 3,
      yPersona + 5,
      { width: COLUMNAS[COLUMNA_TELEFONO].ancho - 6 },
    );

    // Filete tenue entre personas, y SOLO bajo sus dos columnas: cruzar la fila entera
    // partiria visualmente las celdas que el grupo mantiene unidas.
    if (posicion < personas.length - 1) {
      const yLinea = yPersona + altosPersona[posicion];
      documento
        .moveTo(inicioDe[COLUMNA_PERSONAL], yLinea)
        .lineTo(
          inicioDe[COLUMNA_TELEFONO] + COLUMNAS[COLUMNA_TELEFONO].ancho,
          yLinea,
        )
        .strokeColor('#eeeeee')
        .lineWidth(0.3)
        .stroke();
    }

    yPersona += altosPersona[posicion];
  });

  /**
   * DE QUÉ OPERATIVO NACE, bajo su identificador.
   *
   * SE ESCRIBE LA FORMA CORTA —`OCPMO-001` y no `OCPMO-001-21-AGO-2026`— y es inequívoca:
   * la matriz es de **un día** y la fila está dentro de la sección de **un formulario**,
   * así que el prefijo y el secuencial ya identifican al padre sin ambigüedad. El
   * identificador completo no cabe: la columna son 108 puntos y el propio del adicional
   * ya ocupa tres cuartas partes.
   */
  if (operativo.origen) {
    documento
      .fontSize(5)
      .fillColor('#444444')
      .text(
        `de ${formaCorta(operativo.origen.identificador)}`,
        MARGEN + 3,
        y + 11,
        {
          width: COLUMNAS[0].ancho - 6,
          lineBreak: false,
        },
      );
  }

  documento
    .moveTo(MARGEN, y + alto)
    .lineTo(MARGEN + ANCHO_UTIL, y + alto)
    .strokeColor(TINTA.filete)
    .lineWidth(0.4)
    .stroke();

  documento.y = y + alto;
}

/** RN-40. El transporte pendiente se nombra; no se deja la celda en blanco. */
function pendiente(operativo: OperativoDeMatriz): string {
  return operativo.estadoTransporte === 'PROPIOS_MEDIOS'
    ? 'Propios medios'
    : 'Pendiente';
}

/**
 * Las once celdas del operativo, en orden de columna.
 *
 * `null` EN LAS DOS COLUMNAS POR PERSONA (personal y teléfono), y no una cadena vacía: quien
 * las dibuja las salta por identidad, de modo que una celda que de verdad quede vacía siga
 * imprimiéndose. Con '' habría que distinguir dos vacíos que significan cosas distintas.
 */
function celdasCompartidas(operativo: OperativoDeMatriz): (string | null)[] {
  return [
    operativo.identificador,
    `${comoHoraInstitucional(operativo.horaInicio)}–${comoHoraInstitucional(operativo.horaFin)}`,
    null,
    null,
    operativo.zonales.map((fila) => fila.zonal.nombre).join(', ') || '—',
    operativo.puntoEncuentro?.nombre ?? operativo.puntoLibre ?? '—',
    textoDeTipoControl(operativo, '—'),
    operativo.instituciones.map((fila) => fila.institucion.sigla).join(', ') ||
      '—',
    operativo.conductor?.nombreCompleto ?? pendiente(operativo),
    operativo.vehiculo?.placa ?? pendiente(operativo),
    operativo.observaciones.map((nota) => nota.texto).join('\n') || '—',
  ];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CUÁNTO MIDE EL BLOQUE DE UN OPERATIVO. 2026-09-22.
 *
 * Un nombre largo —«BAUTISTA MOREIRA MIRIAM GISELLA»— no cabe en un renglón de la columna de
 * personal: ocupa dos. Antes la fila medía `ALTO_FILA` fijo y el segundo renglón se perdía o
 * cruzaba la raya de abajo. Ahora cada renglón de persona mide lo que su nombre (o su teléfono)
 * necesita, y las columnas compartidas —un punto o una observación largos— también pueden crecer.
 * El bloque mide lo que sea más alto: la suma de las personas o la celda compartida más alta.
 *
 * **NUNCA menos de una fila**: un operativo sin personal conserva su renglón (lleva ALV-01), y
 * `personasDe` ya devuelve una persona «Sin asignar» en ese caso.
 *
 * FIJA LA FUENTE (Helvetica 6.5) porque `heightOfString` mide con la fuente activa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function medirFila(
  documento: PDFKit.PDFDocument,
  operativo: OperativoDeMatriz,
): { alto: number; altosPersona: number[] } {
  documento.font('Helvetica').fontSize(6.5);

  const personas = personasDe(operativo);
  const anchoPersonal = COLUMNAS[COLUMNA_PERSONAL].ancho - 6;
  const anchoTelefono = COLUMNAS[COLUMNA_TELEFONO].ancho - 6;

  const altosPersona = personas.map((persona) =>
    Math.max(
      ALTO_FILA,
      documento.heightOfString(persona.nombre, { width: anchoPersonal }) +
        RELLENO_VERTICAL,
      documento.heightOfString(persona.telefono, { width: anchoTelefono }) +
        RELLENO_VERTICAL,
    ),
  );
  const altoPersonas = altosPersona.reduce((suma, alto) => suma + alto, 0);

  // Las columnas compartidas también pueden crecer (un punto o una observación largos).
  let altoCompartidas = ALTO_FILA;
  celdasCompartidas(operativo).forEach((texto, posicion) => {
    if (texto === null) return;
    const alto =
      documento.heightOfString(texto, { width: COLUMNAS[posicion].ancho - 6 }) +
      RELLENO_VERTICAL;
    if (alto > altoCompartidas) altoCompartidas = alto;
  });

  return { alto: Math.max(altoPersonas, altoCompartidas), altosPersona };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * UN BLOQUE DE LOTE (patrulla 5/6 o registro del 8). 2026-09-22, para que el PDF salga como
 * la pantalla.
 *
 * Son VARIOS operativos de una persona cada uno que comparten `grupoRegistro`. Se pintan como UN
 * bloque: el IDENTIFICADOR baja a la fila de cada código; la PERSONA y el TELÉFONO se fusionan POR
 * PERSONA —con «(n)» cuando lleva varios códigos—; y cada columna general se fusiona SOLO si su
 * dato repite en todos los códigos (ver `columnasFusionadas`); si difiere, baja por fila. La cebra
 * (gris/blanco) la decide `imprimirSeccion` por índice de bloque.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
type GrupoPersona = {
  funcionarioId: number;
  /** Índice de la primera fila (código) de la persona dentro del bloque ordenado. */
  inicio: number;
  /** Cuántos códigos lleva la persona. */
  cantidad: number;
  /** «APELLIDOS NOMBRES (R) (n)», ya con el «(R)» del responsable y el «(n)» del conteo. */
  etiqueta: string;
  telefono: string;
};

/** Ordena los códigos del bloque por identificador, como la pantalla, para que el `rowSpan` calce. */
function ordenarBloque(bloque: OperativoDeMatriz[]): OperativoDeMatriz[] {
  return [...bloque].sort((una, otra) =>
    una.identificador.localeCompare(otra.identificador),
  );
}

/**
 * Agrupa los códigos del bloque POR PERSONA (contiguos, ya que van ordenados por identificador y
 * el prefijo codifica el área de cada quien). Cada persona muestra su nombre una vez, con «(n)».
 */
function gruposDePersona(ordenados: OperativoDeMatriz[]): GrupoPersona[] {
  const grupos: GrupoPersona[] = [];

  ordenados.forEach((operativo, indice) => {
    const asignacion = operativo.personal[0];
    const funcionarioId = asignacion?.funcionarioId ?? -operativo.id;
    const ultimo = grupos[grupos.length - 1];

    if (ultimo && ultimo.funcionarioId === funcionarioId) {
      ultimo.cantidad += 1;
      return;
    }

    const funcionario = asignacion?.funcionario;
    const nombre = funcionario
      ? `${funcionario.apellidos} ${funcionario.nombres}`
      : 'Sin asignar';
    grupos.push({
      funcionarioId,
      inicio: indice,
      cantidad: 1,
      etiqueta: asignacion?.esResponsable ? `${nombre} (R)` : nombre,
      telefono: funcionario?.telefono ?? 'Sin teléfono',
    });
  });

  // El «(n)» se añade al final, cuando ya se sabe cuántos códigos lleva cada persona.
  return grupos.map((grupo) => ({
    ...grupo,
    etiqueta:
      grupo.cantidad > 1
        ? `${grupo.etiqueta} (${grupo.cantidad})`
        : grupo.etiqueta,
  }));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SOLO SE FUSIONA LA COLUMNA CUYO DATO SE REPITE. 2026-09-22, a petición del negocio.
 *
 * Dentro de un lote, una columna general se fusiona (una celda que abarca el bloque) SOLO si su
 * valor es el mismo en TODOS los códigos. Si difiere —dos observaciones distintas, dos horarios—,
 * baja a la fila de cada código, para no ocultar el dato que no repite tras el valor del primero.
 * El identificador siempre va por fila; el personal y el teléfono, por persona.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function columnasFusionadas(celdasPorCodigo: (string | null)[][]): Set<number> {
  const fusionadas = new Set<number>();
  const cabeza = celdasPorCodigo[0];

  COLUMNAS.forEach((_columna, posicion) => {
    // El identificador nunca se fusiona; personal y teléfono van por persona, no por columna.
    if (
      posicion === 0 ||
      posicion === COLUMNA_PERSONAL ||
      posicion === COLUMNA_TELEFONO
    ) {
      return;
    }
    if (
      celdasPorCodigo.every((celdas) => celdas[posicion] === cabeza[posicion])
    ) {
      fusionadas.add(posicion);
    }
  });

  return fusionadas;
}

type BloqueMedido = {
  alto: number;
  alturas: number[];
  ordenados: OperativoDeMatriz[];
  celdasPorCodigo: (string | null)[][];
  fusionadas: Set<number>;
  grupos: GrupoPersona[];
};

/**
 * Mide un bloque de lote: una fila por código, el nombre/teléfono por persona, y cada columna
 * general fusionada SOLO si repite (ver `columnasFusionadas`). Devuelve la altura total, la de cada
 * fila y los datos ya calculados, para que `imprimirBloque` no los recompute.
 */
function medirBloque(
  documento: PDFKit.PDFDocument,
  bloque: OperativoDeMatriz[],
): BloqueMedido {
  documento.font('Helvetica').fontSize(6.5);

  const ordenados = ordenarBloque(bloque);
  const celdasPorCodigo = ordenados.map((operativo) =>
    celdasCompartidas(operativo),
  );
  const fusionadas = columnasFusionadas(celdasPorCodigo);
  const grupos = gruposDePersona(ordenados);
  const anchoPersonal = COLUMNAS[COLUMNA_PERSONAL].ancho - 6;
  const anchoTelefono = COLUMNAS[COLUMNA_TELEFONO].ancho - 6;

  // 1. Cada fila de código debe caber su identificador y las columnas que NO se fusionan (van por
  //    fila): su valor propio puede envolver en dos renglones.
  const alturas = ordenados.map((operativo, indice) => {
    let alto = ALTO_FILA;
    COLUMNAS.forEach((columna, posicion) => {
      if (posicion === COLUMNA_PERSONAL || posicion === COLUMNA_TELEFONO)
        return;
      if (posicion !== 0 && fusionadas.has(posicion)) return; // fusionada: no cuenta por fila
      const texto =
        posicion === 0
          ? operativo.identificador
          : celdasPorCodigo[indice][posicion];
      if (texto === null) return;
      const necesita =
        documento.heightOfString(texto, { width: columna.ancho - 6 }) +
        RELLENO_VERTICAL;
      if (necesita > alto) alto = necesita;
    });
    return alto;
  });

  // 2. El tramo de cada persona (sus códigos) debe caber su nombre y su teléfono.
  for (const grupo of grupos) {
    const necesita = Math.max(
      documento.heightOfString(grupo.etiqueta, { width: anchoPersonal }) +
        RELLENO_VERTICAL,
      documento.heightOfString(grupo.telefono, { width: anchoTelefono }) +
        RELLENO_VERTICAL,
    );
    let actual = 0;
    for (let k = 0; k < grupo.cantidad; k += 1)
      actual += alturas[grupo.inicio + k];
    if (necesita > actual) alturas[grupo.inicio] += necesita - actual;
  }

  // 3. Las columnas FUSIONADAS abarcan todo el bloque: su celda (la del primer código) debe caber.
  let altoFusionadas = ALTO_FILA;
  for (const posicion of fusionadas) {
    const texto = celdasPorCodigo[0][posicion];
    if (texto === null) continue;
    const necesita =
      documento.heightOfString(texto, { width: COLUMNAS[posicion].ancho - 6 }) +
      RELLENO_VERTICAL;
    if (necesita > altoFusionadas) altoFusionadas = necesita;
  }
  const total = alturas.reduce((suma, alto) => suma + alto, 0);
  if (altoFusionadas > total) alturas[0] += altoFusionadas - total;

  return {
    alto: alturas.reduce((suma, alto) => suma + alto, 0),
    alturas,
    ordenados,
    celdasPorCodigo,
    fusionadas,
    grupos,
  };
}

/** Pinta un bloque de lote. Ver `medirBloque` para el modelo de filas, alturas y fusión. */
function imprimirBloque(
  documento: PDFKit.PDFDocument,
  bloque: OperativoDeMatriz[],
  bandaGris: boolean,
): void {
  const { alto, alturas, ordenados, celdasPorCodigo, fusionadas, grupos } =
    medirBloque(documento, bloque);
  const y = documento.y;
  let x = MARGEN;

  // CEBRA POR BLOQUE: abarca todo el lote, así los códigos se leen como UN operativo.
  if (bandaGris) {
    documento.rect(MARGEN, y, ANCHO_UTIL, alto).fill(TINTA.cebra);
  }

  documento.font('Helvetica').fontSize(6.5).fillColor('#000000');

  const inicioDe: number[] = [];
  for (const [posicion, columna] of COLUMNAS.entries()) {
    inicioDe[posicion] = x;
    x += columna.ancho;
  }

  // Columnas FUSIONADAS (las que repiten): una sola vez, al inicio del bloque.
  for (const posicion of fusionadas) {
    const texto = celdasPorCodigo[0][posicion];
    if (texto !== null) {
      documento.text(texto, inicioDe[posicion] + 3, y + 5, {
        width: COLUMNAS[posicion].ancho - 6,
      });
    }
  }

  // POR FILA: el identificador y las columnas generales que NO se fusionan (su dato difiere).
  let yFila = y;
  ordenados.forEach((operativo, indice) => {
    documento.text(operativo.identificador, inicioDe[0] + 3, yFila + 5, {
      width: COLUMNAS[0].ancho - 6,
    });
    COLUMNAS.forEach((columna, posicion) => {
      if (
        posicion === 0 ||
        posicion === COLUMNA_PERSONAL ||
        posicion === COLUMNA_TELEFONO ||
        fusionadas.has(posicion)
      ) {
        return;
      }
      const texto = celdasPorCodigo[indice][posicion];
      if (texto !== null) {
        documento.text(texto, inicioDe[posicion] + 3, yFila + 5, {
          width: columna.ancho - 6,
        });
      }
    });
    yFila += alturas[indice];
  });

  // PERSONAL y TELÉFONO por PERSONA: una celda que abarca los códigos de esa persona.
  for (const grupo of grupos) {
    let yPersona = y;
    for (let k = 0; k < grupo.inicio; k += 1) yPersona += alturas[k];
    documento.text(
      grupo.etiqueta,
      inicioDe[COLUMNA_PERSONAL] + 3,
      yPersona + 5,
      {
        width: COLUMNAS[COLUMNA_PERSONAL].ancho - 6,
      },
    );
    documento.text(
      grupo.telefono,
      inicioDe[COLUMNA_TELEFONO] + 3,
      yPersona + 5,
      {
        width: COLUMNAS[COLUMNA_TELEFONO].ancho - 6,
      },
    );
  }

  // Filete de cierre del bloque entero.
  documento
    .moveTo(MARGEN, y + alto)
    .lineTo(MARGEN + ANCHO_UTIL, y + alto)
    .strokeColor(TINTA.filete)
    .lineWidth(0.4)
    .stroke();

  documento.y = y + alto;
}

/**
 * Las personas del operativo, una por renglon, con su telefono.
 *
 * SUSTITUYE A `personalDe`, que devolvia `APELLIDO +2`. Aquel resumen no era una
 * abreviatura: era informacion que no llegaba al documento firmado, y el documento
 * firmado es el que se reparte.
 *
 * EL TELEFONO SALE DEL MAESTRO EN CADA EXPORTACION (RN-34), no de una copia guardada en
 * la asignacion: un numero corregido en P-07 tiene que salir corregido en el PDF del dia
 * siguiente. Que falte es un caso real del maestro, y se dice con palabras.
 */
function personasDe(
  operativo: OperativoDeMatriz,
): { nombre: string; telefono: string }[] {
  if (operativo.personal.length === 0) {
    return [{ nombre: 'Sin asignar', telefono: '—' }];
  }

  return operativo.personal.map((fila) => ({
    nombre: `${fila.funcionario.apellidos} ${fila.funcionario.nombres}`,
    telefono: fila.funcionario.telefono ?? 'Sin teléfono',
  }));
}

// ─────────────────────────── Firmas ───────────────────────────

/**
 * El bloque de firmas. Es lo que convierte la impresión en un documento formal, y la
 * razón por la que el PDF no puede ser una captura de la pantalla.
 */
function imprimirFirmas(documento: PDFKit.PDFDocument): void {
  exigirEspacio(documento, 90);
  documento.moveDown(2);

  const y = documento.y;
  const ancho = 220;
  const separacion = (ANCHO_UTIL - ancho * 2) / 3;

  const firmas = [
    { titulo: 'Elaborado por', detalle: 'Dirección Nacional de Planificación' },
    { titulo: 'Aprobado por', detalle: 'Dirección' },
  ];

  firmas.forEach((firma, indice) => {
    const x = MARGEN + separacion + (ancho + separacion) * indice;

    documento
      .moveTo(x, y + 34)
      .lineTo(x + ancho, y + 34)
      .strokeColor('#000000')
      .lineWidth(0.6)
      .stroke();

    documento
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor('#000000')
      .text(firma.titulo, x, y + 38, { width: ancho, align: 'center' });

    documento
      .font('Helvetica')
      .fontSize(7.5)
      .text(firma.detalle, x, y + 49, { width: ancho, align: 'center' });
  });
}

// ─────────────────────────── Apoyo ───────────────────────────

/** Abre página nueva si lo que viene no cabe. Evita filas partidas por la mitad. */
function exigirEspacio(documento: PDFKit.PDFDocument, alto: number): void {
  const limite = documento.page.height - MARGEN;

  if (documento.y + alto > limite) {
    documento.addPage();
  }
}

/**
 * Blanco o negro según el fondo, para que el nombre del formulario se lea.
 *
 * Los colores son dato institucional y algunos son oscuros: escribir siempre en negro
 * dejaría ilegible el banner del formulario 6. La fórmula es la luminancia relativa
 * habitual; PV-23 —la verificación formal de contraste— sigue pendiente.
 */
function contrasteSobre(color: string): string {
  const hex = color.replace('#', '');

  if (hex.length !== 6) return '#000000';

  const rojo = Number.parseInt(hex.slice(0, 2), 16);
  const verde = Number.parseInt(hex.slice(2, 4), 16);
  const azul = Number.parseInt(hex.slice(4, 6), 16);

  const luminancia = (0.299 * rojo + 0.587 * verde + 0.114 * azul) / 255;

  return luminancia > 0.6 ? '#000000' : '#ffffff';
}

/**
 * `OCPMO-001-21-AGO-2026` → `OCPMO-001`.
 *
 * La matriz es de un solo día, así que la fecha del identificador se repite en cada fila
 * y no distingue nada. Lo que identifica al operativo dentro de su sección es el prefijo y
 * el secuencial. Si el texto no tuviera la forma esperada se devuelve entero: es mejor una
 * celda apretada que un identificador recortado a la mitad.
 */
function formaCorta(identificador: string): string {
  const partes = /^([A-Z]{1,12}-\d{3})-/.exec(identificador);
  return partes ? partes[1] : identificador;
}
