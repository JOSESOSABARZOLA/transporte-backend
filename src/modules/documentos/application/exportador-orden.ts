/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: exportador-orden.ts
 * Responsabilidad: Imprimir la orden de servicio de una persona.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * VERTICAL, UNA HOJA POR PERSONA, CON EL AVISO DE AISLAMIENTO.
 *
 * Es el caso 9 del plan y el reverso de la matriz: aquella es horizontal y muestra la
 * jornada entera a la Dirección; esta es vertical, cabe en un teléfono y muestra
 * **cuatro datos**.
 *
 * El aviso —«Este documento contiene únicamente su asignación»— no es cortesía: es lo
 * que le dice al funcionario que no le falta información, para que no busque el resto
 * por otro canal. RN-51 explica por qué importa.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ESTA FUNCIÓN RECIBE EL DATO AISLADO, NO EL OPERATIVO. Igual que POL-09, y por el mismo
 * motivo: aquí tampoco hay nada más que se pueda imprimir por descuido. Lo único que
 * acompaña al dato es el código de la orden y la fecha, que identifican al documento.
 */

import PDFDocument from 'pdfkit';

import { marcaDeTiempo } from '../../../common/utilidades/marca-tiempo';
import type { DatoAislado } from '../domain/dato-aislado';
import {
  imprimirFilete,
  imprimirMembrete,
  TINTA,
} from './identidad-institucional';

const MARGEN = 48;
/** A4 vertical: 595 puntos de ancho. */
const ANCHO_UTIL = 595 - MARGEN * 2;

/** Lo que identifica al documento, además de su contenido. */
export interface EncabezadoOrden {
  codigo: string;
  fechaNatural: string;
  emitidaEn: Date;
}

/** Compone la orden y la devuelve completa. Una sola página por persona. */
export async function exportarOrden(
  encabezado: EncabezadoOrden,
  dato: DatoAislado,
): Promise<Buffer> {
  const documento = new PDFDocument({
    size: 'A4',
    layout: 'portrait',
    margin: MARGEN,
    info: {
      Title: `Orden de servicio ${encabezado.codigo}`,
      Author: 'Agencia Metropolitana de Control',
      Subject: 'Orden de servicio individual',
    },
  });

  const partes: Buffer[] = [];
  documento.on('data', (parte: Buffer) => partes.push(parte));

  const terminado = new Promise<Buffer>((resolver) => {
    documento.on('end', () => resolver(Buffer.concat(partes)));
  });

  imprimirCabecera(documento, encabezado);
  imprimirCampos(documento, dato);
  imprimirAviso(documento, encabezado);

  documento.end();
  return terminado;
}

/** Ancho del logotipo en la orden. A4 vertical: cabe holgado y se lee al imprimir. */
const ANCHO_LOGO = 232;

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL MEMBRETE ES EL LOGOTIPO, Y POR ESO SE FUE EL TITULAR DE TEXTO.
 *
 * El bloque institucional que entrega la DNP **ya dice** «Agencia Metropolitana de
 * Control» y «Quito · Alcaldía Metropolitana». Repetirlo debajo en Helvetica no añadía
 * nada y competía con lo único que esta hoja tiene que gritar: **de quién es la orden y
 * cuál es**.
 *
 * Lo que queda es una jerarquía de tres pisos: la institución (logotipo), el tipo de
 * documento (versalita azul, como pide el manual para los títulos) y su identidad
 * (el código, que es lo que se cita por radio y lo que se archiva).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function imprimirCabecera(
  documento: PDFKit.PDFDocument,
  encabezado: EncabezadoOrden,
): void {
  const finLogo = imprimirMembrete(documento, {
    ancho: ANCHO_LOGO,
    x: MARGEN + (ANCHO_UTIL - ANCHO_LOGO) / 2,
    y: MARGEN,
    respaldo: 'AGENCIA METROPOLITANA DE CONTROL',
  });

  documento
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor(TINTA.institucional)
    .text('ORDEN DE SERVICIO', MARGEN, finLogo + 22, {
      width: ANCHO_UTIL,
      align: 'center',
      characterSpacing: 2.2,
    });

  documento
    .font('Helvetica-Bold')
    .fontSize(17)
    .fillColor(TINTA.cuerpo)
    .text(encabezado.codigo, MARGEN, documento.y + 8, {
      width: ANCHO_UTIL,
      align: 'center',
    });

  documento
    .font('Helvetica')
    .fontSize(9.5)
    .fillColor(TINTA.apoyo)
    .text(encabezado.fechaNatural, MARGEN, documento.y + 3, {
      width: ANCHO_UTIL,
      align: 'center',
    });

  imprimirFilete(documento, MARGEN, documento.y + 16, ANCHO_UTIL);
  documento.y += 16;
}

/**
 * Los cuatro campos, y **solo los cuatro**.
 *
 * El recorrido se construye desde el dato aislado: no hay una lista de campos que
 * alguien pueda ampliar sin querer, porque no hay de dónde sacar un quinto.
 */
function imprimirCampos(
  documento: PDFKit.PDFDocument,
  dato: DatoAislado,
): void {
  const campos: [string, string][] = [
    ['FUNCIONARIO', dato.funcionario],
    ['HORARIO', dato.horario],
    [
      'CONDUCTOR',
      dato.conductor
        ? `${dato.conductor.nombre}${dato.conductor.telefono ? `\n${dato.conductor.telefono}` : ''}`
        : 'Sin conductor asignado',
    ],
    ['PLACA', dato.placa ?? 'Sin vehículo asignado'],
  ];

  /*
    LAS CUATRO EN UNA CAJA, Y LA CAJA ES RECTA.

    Sueltas sobre el blanco se leían como cuatro apuntes; encerradas se leen como **la
    asignación**, que es lo que son (INV-24, RN-50). El manual de marca pide cajas rectas:
    `rect`, no `roundedRect`, y filete de un punto sin sombra.

    El alto se mide antes de dibujar el marco, porque el nombre del conductor y su teléfono
    ocupan dos renglones y el resto uno: un alto fijo dejaría la caja corta o sobrada.
  */
  const ALTO_CAMPO = 56;
  const ALTO_CONDUCTOR = 74;
  const altoCaja =
    ALTO_CAMPO * 3 + (dato.conductor?.telefono ? ALTO_CONDUCTOR : ALTO_CAMPO);
  const arriba = documento.y + 26;

  documento
    .rect(MARGEN, arriba, ANCHO_UTIL, altoCaja)
    .strokeColor(TINTA.institucional)
    .lineWidth(1)
    .stroke();

  let y = arriba;

  campos.forEach(([titulo, valor], indice) => {
    const alto =
      titulo === 'CONDUCTOR' && dato.conductor?.telefono
        ? ALTO_CONDUCTOR
        : ALTO_CAMPO;

    // Filete de separación entre casillas, no alrededor: el marco ya está.
    if (indice > 0) {
      documento
        .moveTo(MARGEN, y)
        .lineTo(MARGEN + ANCHO_UTIL, y)
        .strokeColor(TINTA.filete)
        .lineWidth(0.6)
        .stroke();
    }

    documento
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(TINTA.apoyo)
      .text(titulo, MARGEN + 18, y + 12, {
        width: ANCHO_UTIL - 36,
        characterSpacing: 1.4,
      });

    documento
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor(TINTA.cuerpo)
      .text(valor, MARGEN + 18, y + 26, { width: ANCHO_UTIL - 36 });

    y += alto;
  });

  documento.y = arriba + altoCaja;
}

/** FASE5 §9.6. El aviso que evita que el funcionario busque el resto por otro canal. */
function imprimirAviso(
  documento: PDFKit.PDFDocument,
  encabezado: EncabezadoOrden,
): void {
  const y = documento.page.height - MARGEN - 86;

  /*
    RELLENO TENUE Y FILETE, NO UN BLOQUE DE COLOR. Es la misma regla que rige los avisos
    de la aplicación: el manual prohíbe los complementarios como fondos completos.
  */
  documento.rect(MARGEN, y, ANCHO_UTIL, 46).fill(TINTA.reposo);
  documento
    .rect(MARGEN, y, ANCHO_UTIL, 46)
    .strokeColor(TINTA.filete)
    .lineWidth(0.8)
    .stroke();

  documento
    .font('Helvetica')
    .fontSize(9)
    .fillColor(TINTA.institucional)
    .text(
      'Este documento contiene únicamente su asignación. No incluye al resto del personal del operativo ni los demás operativos de la jornada.',
      MARGEN + 16,
      y + 13,
      { width: ANCHO_UTIL - 32, align: 'center' },
    );

  imprimirFilete(documento, MARGEN, y + 62, ANCHO_UTIL, 0.8);

  /*
    LA FECHA DE EMISIÓN EN LA ZONA DE QUITO, NO EN UTC.

    Decía `emitidaEn.toISOString().slice(0, 10)`, y eso **imprimía el día equivocado** en
    toda emisión posterior a las 19H00: Quito es UTC−5, así que una orden emitida el 25 a
    las 20H00 salía fechada el 26. En un documento que se entrega y se archiva, la fecha
    es parte de lo que se firma.

    `marcaDeTiempo` devuelve ISO 8601 con desfase —`2026-08-25T20:00:00-05:00`—, y los
    diez primeros caracteres son ya el día correcto.
  */
  documento
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(TINTA.apoyo)
    .text(
      `Emitida el ${marcaDeTiempo(encabezado.emitidaEn).slice(0, 10)} por la Dirección · Agencia Metropolitana de Control`,
      MARGEN,
      y + 70,
      { width: ANCHO_UTIL, align: 'center' },
    );
}
