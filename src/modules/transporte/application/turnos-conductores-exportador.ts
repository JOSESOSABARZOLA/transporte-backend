/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores-exportador.ts
 * Responsabilidad: Exportar la matriz mensual de turnos de conductores a Excel (.xlsx).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Mismo formato que la cobertura de Instrucción (`cobertura-exportador.ts`): un día por columna
 * («LUNES 01»), el turno con relleno de color y filas de totales. `exceljs` está autorizado para
 * esta exportación (CLAUDE.md §2, ampliado el 2026-10-06). La paleta ARGB es del archivo, no de la
 * interfaz.
 */

import * as ExcelJS from 'exceljs';

import {
  cabeceraDia,
  COLOR_ESTADO,
  TEXTO_ESTADO,
} from '../../talento-operativo/application/cobertura-exportador';
import type { MatrizTurnosConductores } from './turnos-conductores.service';

const TEXTO_TURNO: Record<string, string> = {
  ...TEXTO_ESTADO,
  DIA: 'DÍA',
  NOCHE: 'NOCHE',
  ECU_NOCHE: 'ECU NOCHE',
  LIBRE: 'LIBRE',
  ADMINISTRATIVO: 'ADMINISTRATIVO',
};

const COLOR_TURNO: Record<string, string> = {
  ...COLOR_ESTADO,
  DIA: 'FFFFF2CC',
  NOCHE: 'FFBDD7EE',
  ECU_NOCHE: 'FF9BC2E6',
  LIBRE: 'FFE2EFDA',
  ADMINISTRATIVO: 'FFEDEDED',
};

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

export async function exportarTurnosConductoresXlsx(
  matriz: MatrizTurnosConductores,
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Agencia Metropolitana de Control';
  const hoja = libro.addWorksheet(`Conductores ${matriz.mes}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });

  const cabecera = hoja.addRow([
    'SECTOR',
    'CONTRATO',
    'CONDUCTOR',
    ...matriz.dias.map(cabeceraDia),
    'OBSERVACIÓN',
  ]);
  cabecera.font = { bold: true };
  cabecera.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
  cabecera.eachCell((celda) => {
    celda.border = BORDE;
  });

  for (const conductor of matriz.conductores) {
    const fila = hoja.addRow([
      conductor.sector ?? '',
      conductor.tipoContrato ?? '',
      conductor.nombre,
      ...conductor.celdas.map((c) =>
        c.estado ? (TEXTO_TURNO[c.estado] ?? c.estado) : '',
      ),
      '',
    ]);
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE;
    });
    conductor.celdas.forEach((c, indice) => {
      const color = c.estado ? COLOR_TURNO[c.estado] : undefined;
      if (!color) return;
      const celda = fila.getCell(4 + indice);
      celda.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: color },
      };
      celda.alignment = { horizontal: 'center' };
    });
  }

  const filasTotales: [
    string,
    'dia' | 'noche' | 'ecuNoche' | 'libre' | 'administrativo',
  ][] = [
    ['Día', 'dia'],
    ['Noche', 'noche'],
    ['ECU noche', 'ecuNoche'],
    ['Libres', 'libre'],
    ['Administrativos', 'administrativo'],
  ];
  for (const [rotulo, campo] of filasTotales) {
    const fila = hoja.addRow([
      '',
      '',
      rotulo,
      ...matriz.totales.map((t) => t[campo]),
    ]);
    fila.font = { bold: true };
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE;
    });
  }

  hoja.getColumn(1).width = 12;
  hoja.getColumn(2).width = 16;
  hoja.getColumn(3).width = 34;
  for (let i = 0; i < matriz.dias.length; i += 1)
    hoja.getColumn(4 + i).width = 13;
  hoja.getColumn(4 + matriz.dias.length).width = 28;

  return Buffer.from(await libro.xlsx.writeBuffer());
}
