/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: importar-horario.spec.ts
 * Responsabilidad: Verificar la interpretación del HORARIO de la DAF y su lectura desde un .xlsx real.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import * as ExcelJS from 'exceljs';

import { leerHojaHorario } from '../turnos-conductores-importador';
import {
  fechaDeCabecera,
  previsualizarHorario,
  type ValorCelda,
} from './importar-horario';

const CONDUCTORES = [
  { id: 1, cedula: '1712345678', nombreCompleto: 'Pérez Juan' },
  { id: 2, cedula: '1798765432', nombreCompleto: 'Ruiz Ana' },
  { id: 3, cedula: '1700000001', nombreCompleto: 'Mora Luis' },
  { id: 4, cedula: '1700000002', nombreCompleto: 'Mora Luis' },
];

const CABECERA: ValorCelda[] = [
  'N°',
  'SECTOR DONDE VIVE',
  'NOMBRES',
  'LUNES 01',
  'MARTES 02',
  'MIÉRCOLES 03',
];

const hojaCon = (...filas: ValorCelda[][]): ValorCelda[][] => [
  ['HORARIO OCTUBRE'],
  CABECERA,
  ...filas,
];

describe('previsualizarHorario', () => {
  it('fila válida: empareja por nombre (sin tildes) y traduce los valores', () => {
    const r = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([
        1,
        'NORTE',
        'PEREZ JUAN',
        'OPERATIVO DIA',
        'operativo noche',
        'ACTIVIDADES ADMINISTRATIVAS',
      ]),
      conductores: CONDUCTORES,
      ausencias: [],
    });

    expect(r.filas).toEqual([
      expect.objectContaining({
        fila: 3,
        conductorId: 1,
        celdas: 3,
        errores: [],
      }),
    ]);
    expect(r.celdas).toEqual([
      { conductorId: 1, fecha: '2026-10-01', turno: 'DIA' },
      { conductorId: 1, fecha: '2026-10-02', turno: 'NOCHE' },
      { conductorId: 1, fecha: '2026-10-03', turno: 'ADMINISTRATIVO' },
    ]);
  });

  it('nombre desconocido: la fila entera es inválida', () => {
    const r = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([2, 'SUR', 'NADIE CONOCIDO', 'LIBRE', '', '']),
      conductores: CONDUCTORES,
      ausencias: [],
    });

    expect(r.filas[0].conductorId).toBeNull();
    expect(r.filas[0].errores[0]).toMatch(/No hay un conductor activo/);
    expect(r.celdas).toHaveLength(0);
  });

  it('nombre ambiguo: pide la cédula; con cédula en la fila sí empareja', () => {
    const ambigua = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([3, 'SUR', 'MORA LUIS', 'LIBRE', '', '']),
      conductores: CONDUCTORES,
      ausencias: [],
    });
    expect(ambigua.filas[0].errores[0]).toMatch(/Hay 2 conductores/);

    const conCedula = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([3, '1700000002', 'MORA LUIS', 'LIBRE', '', '']),
      conductores: CONDUCTORES,
      ausencias: [],
    });
    expect(conCedula.filas[0].conductorId).toBe(4);
    expect(conCedula.celdas).toEqual([
      { conductorId: 4, fecha: '2026-10-01', turno: 'LIBRE' },
    ]);
  });

  it('valor no reconocido: error de esa celda, el resto de la fila se importa', () => {
    const r = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([4, 'NORTE', 'Ruiz Ana', 'ECU NOCHE', 'TURNO RARO', '']),
      conductores: CONDUCTORES,
      ausencias: [],
    });

    expect(r.filas[0].celdas).toBe(1);
    expect(r.filas[0].errores).toEqual([
      'Día 02: valor «TURNO RARO» no reconocido.',
    ]);
    expect(r.omitidas).toHaveLength(1);
  });

  it('VACACIONES no se escribe: avisa si no hay ausencia; calla si ya está registrada', () => {
    const sinAusencia = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([
        5,
        'NORTE',
        'Ruiz Ana',
        'VACACIONES',
        'OPERATIVO DIA',
        '',
      ]),
      conductores: CONDUCTORES,
      ausencias: [],
    });
    expect(sinAusencia.celdas).toEqual([
      { conductorId: 2, fecha: '2026-10-02', turno: 'DIA' },
    ]);
    expect(sinAusencia.filas[0].errores[0]).toMatch(
      /regístrelas en Flota y garajes › Conductores › Ausencias/,
    );

    const conAusencia = previsualizarHorario({
      mes: '2026-10',
      hoja: hojaCon([
        5,
        'NORTE',
        'Ruiz Ana',
        'VACACIONES',
        'OPERATIVO DIA',
        '',
      ]),
      conductores: CONDUCTORES,
      ausencias: [{ conductorId: 2, desde: '2026-10-01', hasta: '2026-10-02' }],
    });
    // El día 2 también está cubierto por la ausencia: no se escribe encima.
    expect(conAusencia.celdas).toHaveLength(0);
    expect(conAusencia.filas[0].errores).toEqual([]);
    expect(conAusencia.omitidas[0].motivo).toMatch(/ausencia registrada/);
  });

  it('sin la columna NOMBRES devuelve un error de formato', () => {
    const r = previsualizarHorario({
      mes: '2026-10',
      hoja: [
        ['A', 'B'],
        ['x', 'y'],
      ],
      conductores: CONDUCTORES,
      ausencias: [],
    });
    expect(r.filas[0].errores[0]).toMatch(/NOMBRES/);
  });
});

describe('fechaDeCabecera', () => {
  it('admite fecha de Excel, número, «LUNES 01», ISO y DD/MM/AAAA del mes', () => {
    expect(fechaDeCabecera(new Date(Date.UTC(2026, 9, 5)), 2026, 10, 31)).toBe(
      '2026-10-05',
    );
    expect(fechaDeCabecera(7, 2026, 10, 31)).toBe('2026-10-07');
    expect(fechaDeCabecera('LUNES 01', 2026, 10, 31)).toBe('2026-10-01');
    expect(fechaDeCabecera('2026-10-09', 2026, 10, 31)).toBe('2026-10-09');
    expect(fechaDeCabecera('10/10/2026', 2026, 10, 31)).toBe('2026-10-10');
  });

  it('ignora otro mes y días inexistentes', () => {
    expect(fechaDeCabecera('2026-11-01', 2026, 10, 31)).toBeNull();
    expect(fechaDeCabecera(32, 2026, 10, 31)).toBeNull();
    expect(fechaDeCabecera('NOMBRES', 2026, 10, 31)).toBeNull();
  });
});

describe('leerHojaHorario (xlsx real)', () => {
  it('lee la primera hoja y la previsualización la entiende', async () => {
    const libro = new ExcelJS.Workbook();
    const hoja = libro.addWorksheet('HORARIO');
    hoja.addRow(CABECERA);
    hoja.addRow([1, 'NORTE', 'Pérez Juan', 'OPERATIVO DIA', 'LIBRE', '']);
    const buffer = Buffer.from(await libro.xlsx.writeBuffer());

    const filas = await leerHojaHorario(buffer);
    const r = previsualizarHorario({
      mes: '2026-10',
      hoja: filas,
      conductores: CONDUCTORES,
      ausencias: [],
    });

    expect(r.celdas).toEqual([
      { conductorId: 1, fecha: '2026-10-01', turno: 'DIA' },
      { conductorId: 1, fecha: '2026-10-02', turno: 'LIBRE' },
    ]);
  });

  it('un archivo que no es xlsx da un error legible', async () => {
    await expect(leerHojaHorario(Buffer.from('no es excel'))).rejects.toThrow(
      /No se pudo leer el archivo/,
    );
  });
});
