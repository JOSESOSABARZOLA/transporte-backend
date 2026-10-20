/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores-importador.ts
 * Responsabilidad: Leer el .xlsx del HORARIO de la DAF y entregarlo como una matriz de celdas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * `exceljs` LEE aquí por autorización del usuario (2026-10-06; ver CLAUDE.md §2). Esta capa SOLO
 * traduce el archivo a valores simples (texto, número o fecha) de la PRIMERA hoja; la interpretación
 * del formato vive en la función pura `politicas/importar-horario.ts`, que es la que se prueba.
 */

import * as ExcelJS from 'exceljs';

import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { ValorCelda } from './politicas/importar-horario';

/** Un valor de celda de exceljs, reducido a texto, número o fecha. */
function simplificar(valor: ExcelJS.CellValue): ValorCelda {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor;
  if (typeof valor === 'string' || typeof valor === 'number') return valor;
  if (typeof valor === 'boolean') return valor ? 'SI' : 'NO';
  if (typeof valor === 'object') {
    if ('richText' in valor) {
      return valor.richText.map((tramo) => tramo.text).join('');
    }
    if ('result' in valor) {
      const resultado = valor.result;
      if (resultado instanceof Date) return resultado;
      if (typeof resultado === 'string' || typeof resultado === 'number') {
        return resultado;
      }
      return null;
    }
    if ('text' in valor && typeof valor.text === 'string') return valor.text;
  }
  return null;
}

/** La primera hoja del libro como matriz de filas × columnas (base 0). */
export async function leerHojaHorario(
  contenido: Buffer,
  formato = 'con el formato HORARIO de la DAF',
): Promise<ValorCelda[][]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    throw new ValidacionError(
      `No se pudo leer el archivo. Debe ser un libro de Excel (.xlsx) ${formato}.`,
    );
  }
  const hoja = libro.worksheets[0];
  if (!hoja) {
    throw new ValidacionError('El archivo no tiene ninguna hoja.');
  }
  const filas: ValorCelda[][] = [];
  hoja.eachRow({ includeEmpty: true }, (fila, numero) => {
    const valores: ValorCelda[] = [];
    fila.eachCell({ includeEmpty: true }, (celda, columna) => {
      valores[columna - 1] = simplificar(celda.value);
    });
    filas[numero - 1] = Array.from(valores, (v) => v ?? null);
  });
  return Array.from(filas, (fila) => fila ?? []);
}
