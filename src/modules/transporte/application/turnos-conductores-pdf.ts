/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores-pdf.ts
 * Responsabilidad: Definir el reporte PDF de la matriz mensual de turnos de conductores.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * Mismo contenido que el Excel (`turnos-conductores-exportador.ts`): un conductor por fila y un día
 * por columna, con las filas de totales. Va en A3 apaisado para que quepan 31 días. Lo genera el
 * motor de documentos de siempre (pdfmake); el turno se escribe con su letra para que el reporte no
 * dependa del color (regla 6). Solo se emite para un mes PUBLICADO (lo exige el servicio).
 */

import type {
  Content,
  TableCell,
  TDocumentDefinitions,
} from 'pdfmake/interfaces';

import {
  HAY_LOGOTIPO,
  RUTA_LOGOTIPO,
} from '../../documentos/application/motor-documento';
import type { MatrizTurnosConductores } from './turnos-conductores.service';

const LETRA_TURNO: Record<string, string> = {
  DIA: 'D',
  NOCHE: 'N',
  ECU_NOCHE: 'E',
  LIBRE: 'L',
  ADMINISTRATIVO: 'A',
};

/** Relleno suave por turno (el PDF es un archivo: su paleta no es la de la interfaz). */
const RELLENO_TURNO: Record<string, string> = {
  DIA: '#FFF2CC',
  NOCHE: '#BDD7EE',
  ECU_NOCHE: '#9BC2E6',
  LIBRE: '#E2EFDA',
  ADMINISTRATIVO: '#EDEDED',
};

const INICIAL_DIA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

function cabeceraDia(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const semana = new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay();
  return `${INICIAL_DIA[semana]}\n${String(dia).padStart(2, '0')}`;
}

export function definicionTurnosConductoresPdf(
  matriz: MatrizTurnosConductores,
): TDocumentDefinitions {
  const encabezado = (texto: string): TableCell => ({
    text: texto,
    bold: true,
    alignment: 'center',
    fillColor: '#EEF2F8',
  });

  const filasConductor: TableCell[][] = matriz.conductores.map((c) => [
    { text: c.nombre, noWrap: false },
    c.sector ?? '',
    ...c.celdas.map(
      (celda): TableCell => ({
        text: celda.estado
          ? (LETRA_TURNO[celda.estado] ??
            (celda.esAusencia ? 'AUS' : celda.estado))
          : '',
        alignment: 'center',
        fillColor: celda.estado ? RELLENO_TURNO[celda.estado] : undefined,
        italics: celda.esAusencia,
      }),
    ),
  ]);

  const totales: [
    string,
    (t: MatrizTurnosConductores['totales'][0]) => number,
  ][] = [
    ['Día', (t) => t.dia],
    ['Noche', (t) => t.noche],
    ['ECU noche', (t) => t.ecuNoche],
    ['Libres', (t) => t.libre],
    ['Ausencias', (t) => t.ausencias],
  ];
  const filasTotales: TableCell[][] = totales.map(([rotulo, valor]) => [
    { text: rotulo, bold: true },
    '',
    ...matriz.totales.map(
      (t): TableCell => ({
        text: String(valor(t)),
        alignment: 'center',
        bold: true,
      }),
    ),
  ]);

  const cuerpo: Content[] = [
    ...(HAY_LOGOTIPO()
      ? [
          {
            image: RUTA_LOGOTIPO,
            width: 140,
            alignment: 'center' as const,
            margin: [0, 0, 0, 6] as [number, number, number, number],
          },
        ]
      : []),
    {
      text: `Turnos de conductores · ${matriz.mes}`,
      bold: true,
      fontSize: 13,
      alignment: 'center',
      margin: [0, 0, 0, 2],
    },
    {
      text: 'D día · N noche · E ECU noche · L libre · A administrativo · en cursiva, ausencias',
      fontSize: 7,
      italics: true,
      alignment: 'center',
      margin: [0, 0, 0, 8],
    },
    {
      table: {
        headerRows: 1,
        widths: [130, 40, ...matriz.dias.map(() => '*')],
        body: [
          [
            encabezado('Conductor'),
            encabezado('Sector'),
            ...matriz.dias.map((d) => encabezado(cabeceraDia(d))),
          ],
          ...filasConductor,
          ...filasTotales,
        ],
      },
      layout: 'lightHorizontalLines',
    },
  ];

  return {
    pageSize: 'A3',
    pageOrientation: 'landscape',
    pageMargins: [24, 24, 24, 24],
    defaultStyle: { font: 'Roboto', fontSize: 7 },
    info: { title: `Turnos de conductores ${matriz.mes}` },
    content: cuerpo,
  };
}
