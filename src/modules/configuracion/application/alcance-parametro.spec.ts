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

  it('son exactamente las cuatro ventanas de turno', () => {
    expect([...PARAMETROS_SOLO_DMIT].sort()).toEqual([
      'HORA_TURNO_DIURNO_FIN',
      'HORA_TURNO_DIURNO_INICIO',
      'HORA_TURNO_NOCTURNO_FIN',
      'HORA_TURNO_NOCTURNO_INICIO',
    ]);
  });
});
