/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: alcance-parametro.spec.ts
 * Responsabilidad: Fijar quién ve cada parámetro según su rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 */

import { RolDepartamental } from '@prisma/client';

import { PARAMETROS_SOLO_DMIT, puedeVerParametro } from './alcance-parametro';

const DMIT = [RolDepartamental.ADMINISTRADOR_DMIT];
const DMIP = [RolDepartamental.ADMINISTRADOR_DMIP];
const GENERAL = [RolDepartamental.ADMINISTRADOR];

describe('puedeVerParametro', () => {
  it('un parámetro de turno lo ve SOLO el ADMINISTRADOR_DMIT', () => {
    for (const clave of PARAMETROS_SOLO_DMIT) {
      expect(puedeVerParametro(clave, DMIT)).toBe(true);
      expect(puedeVerParametro(clave, DMIP)).toBe(false);
      expect(puedeVerParametro(clave, GENERAL)).toBe(false);
    }
  });

  it('la configuración general la ven el DMIP y el ADMINISTRADOR, no el DMIT', () => {
    for (const clave of ['JORNADA_MAXIMA_HORAS', 'FRANJA_NOCTURNA_INICIO']) {
      expect(puedeVerParametro(clave, DMIP)).toBe(true);
      expect(puedeVerParametro(clave, GENERAL)).toBe(true);
      expect(puedeVerParametro(clave, DMIT)).toBe(false);
    }
  });

  it('quien tiene ambos roles ve la unión: los turnos y la configuración general', () => {
    const ambos = [
      RolDepartamental.ADMINISTRADOR_DMIT,
      RolDepartamental.ADMINISTRADOR_DMIP,
    ];
    expect(puedeVerParametro('HORA_TURNO_DIURNO_INICIO', ambos)).toBe(true);
    expect(puedeVerParametro('JORNADA_MAXIMA_HORAS', ambos)).toBe(true);
  });

  it('son las cuatro ventanas de turno y los dos avisos de la cobertura (2026-10-05)', () => {
    expect([...PARAMETROS_SOLO_DMIT].sort()).toEqual([
      'COBERTURA_MAX_DIAS_SIN_DESCANSO',
      'COBERTURA_PERMITE_NOCTURNO_A_DIURNO',
      'HORA_TURNO_DIURNO_FIN',
      'HORA_TURNO_DIURNO_INICIO',
      'HORA_TURNO_NOCTURNO_FIN',
      'HORA_TURNO_NOCTURNO_INICIO',
    ]);
  });
});

describe('puedeVerParametro · parámetros de la DAF (2026-10-07)', () => {
  const DAF = [RolDepartamental.ADMINISTRADOR_DAF];
  const CLAVES_DAF = [
    'DAF_DURACION_TRAMO_MIN',
    'DAF_MIN_CONDUCTORES_DIA',
    'DAF_PERMITE_NOCHE_A_DIA',
    'DAF_DIAS_AVISO_VENCIMIENTO',
  ];

  it('los ve el ADMINISTRADOR_DAF, el general y el DMIP; no el DMIT', () => {
    for (const clave of CLAVES_DAF) {
      expect(puedeVerParametro(clave, DAF)).toBe(true);
      expect(puedeVerParametro(clave, GENERAL)).toBe(true);
      expect(puedeVerParametro(clave, DMIP)).toBe(true);
      expect(puedeVerParametro(clave, DMIT)).toBe(false);
    }
  });

  it('el ADMINISTRADOR_DAF NO ve la configuración general ni los turnos de Instrucción', () => {
    expect(puedeVerParametro('JORNADA_MAXIMA_HORAS', DAF)).toBe(false);
    expect(puedeVerParametro('HORA_TURNO_DIURNO_INICIO', DAF)).toBe(false);
  });
});
