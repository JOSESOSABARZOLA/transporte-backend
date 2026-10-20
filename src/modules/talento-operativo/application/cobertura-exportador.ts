/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-exportador.ts
 * Responsabilidad: Exportar la matriz mensual de cobertura a Excel (.xlsx) con el formato de Instrucción.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL FORMATO ES EL DEL EXCEL QUE INSTRUCCIÓN YA USA: columnas ZONA, DENOMINACIÓN y PERSONAL, un día
 * por columna («LUNES 01»…), el turno escrito con todas sus letras y con relleno de color, filas de
 * totales (Diurnos, Nocturnos, Descansos) y dos columnas al final para Revisión y Observación.
 *
 * `exceljs` está AUTORIZADO desde el 2026-10-05 para esta exportación (CLAUDE.md §2). Es un archivo
 * para Excel, no la interfaz: la paleta va aquí como constante documentada (ARGB), no en el tema.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as ExcelJS from 'exceljs';

import type { MatrizCobertura } from './cobertura-turnos.service';

/** El texto de cada estado en el Excel. */
export const TEXTO_ESTADO: Record<string, string> = {
  DIURNO: 'DIURNO',
  NOCTURNO: 'NOCTURNO',
  DESCANSO: 'DESCANSO',
  VACACIONES: 'VACACIONES',
  REPOSO_MEDICO: 'REPOSO MEDICO',
  CALAMIDAD: 'CALAMIDAD',
  PERMISO: 'PERMISO',
  LICENCIA: 'LICENCIA',
  CAPACITACION: 'CAPACITACION',
  COMISION_SERVICIOS: 'COMISION DE SERVICIOS',
};

/**
 * Relleno sólido por estado (ARGB). Tonos claros para que el texto negro se lea impreso:
 * diurno amarillo, nocturno azul, descanso verde y las ausencias en tonos cálidos/neutros.
 */
export const COLOR_ESTADO: Record<string, string> = {
  DIURNO: 'FFFFF2CC',
  NOCTURNO: 'FFBDD7EE',
  DESCANSO: 'FFE2EFDA',
  VACACIONES: 'FFF8CBAD',
  REPOSO_MEDICO: 'FFF4B084',
  CALAMIDAD: 'FFD9D2E9',
  PERMISO: 'FFEDEDED',
  LICENCIA: 'FFF8CBAD',
  CAPACITACION: 'FFDDEBF7',
  COMISION_SERVICIOS: 'FFDDEBF7',
};

const TEXTO_DENOMINACION: Record<string, string> = {
  LIDER_ZONAL: 'LÍDER ZONAL',
  INSTRUCTOR_METROPOLITANO: 'INSTRUCTOR METROPOLITANO',
  AUXILIAR_FLAGRANCIA: 'AUXILIAR DE FLAGRANCIA',
};

const DIAS_SEMANA = [
  'DOMINGO',
  'LUNES',
  'MARTES',
  'MIÉRCOLES',
  'JUEVES',
  'VIERNES',
  'SÁBADO',
];

/** «LUNES 01» a partir de una fecha AAAA-MM-DD (en UTC, sin huso). */
export function cabeceraDia(fecha: string): string {
  const dia = new Date(`${fecha}T00:00:00.000Z`);
  return `${DIAS_SEMANA[dia.getUTCDay()]} ${fecha.slice(8, 10)}`;
}

const BORDE: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

/** Genera el libro .xlsx de la matriz. */
export async function exportarCoberturaXlsx(
  matriz: MatrizCobertura,
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Agencia Metropolitana de Control';
  const hoja = libro.addWorksheet(`Cobertura ${matriz.mes}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }],
  });

  const cabecera = [
    'ZONA',
    'DENOMINACIÓN',
    'PERSONAL',
    ...matriz.dias.map(cabeceraDia),
    'REVISIÓN',
    'OBSERVACIÓN',
  ];
  const filaCabecera = hoja.addRow(cabecera);
  filaCabecera.font = { bold: true };
  filaCabecera.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
  filaCabecera.eachCell((celda) => {
    celda.border = BORDE;
  });

  // Agrupadas por zona: la matriz ya llega ordenada por zona, denominación y apellidos.
  const personas = [...matriz.personas].sort((a, b) =>
    (a.zona ?? '').localeCompare(b.zona ?? ''),
  );

  for (const persona of personas) {
    const fila = hoja.addRow([
      persona.zona ?? '',
      persona.denominacion
        ? (TEXTO_DENOMINACION[persona.denominacion] ?? persona.denominacion)
        : '',
      persona.nombre,
      ...persona.celdas.map((celda) =>
        celda.estado ? (TEXTO_ESTADO[celda.estado] ?? celda.estado) : '',
      ),
      '',
      '',
    ]);
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE;
    });
    persona.celdas.forEach((celdaMatriz, indice) => {
      const color = celdaMatriz.estado
        ? COLOR_ESTADO[celdaMatriz.estado]
        : undefined;
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

  const filasTotales: [string, 'diurno' | 'nocturno' | 'descanso'][] = [
    ['Diurnos', 'diurno'],
    ['Nocturnos', 'nocturno'],
    ['Descansos', 'descanso'],
  ];
  for (const [rotulo, campo] of filasTotales) {
    const fila = hoja.addRow([
      '',
      '',
      rotulo,
      ...matriz.totales.map((total) => total[campo]),
    ]);
    fila.font = { bold: true };
    fila.eachCell({ includeEmpty: true }, (celda) => {
      celda.border = BORDE;
    });
  }

  hoja.getColumn(1).width = 16;
  hoja.getColumn(2).width = 24;
  hoja.getColumn(3).width = 34;
  for (let indice = 0; indice < matriz.dias.length; indice += 1) {
    hoja.getColumn(4 + indice).width = 13;
  }
  hoja.getColumn(4 + matriz.dias.length).width = 18;
  hoja.getColumn(5 + matriz.dias.length).width = 28;

  const datos = await libro.xlsx.writeBuffer();
  return Buffer.from(datos);
}
