/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · capacidad de flota
 * Archivo: capacidad-calculada.spec.ts
 * Responsabilidad: Verificar el cálculo puro de la capacidad hábil del día.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import { calcularCapacidad } from './capacidad-calculada';

describe('calcularCapacidad', () => {
  it('cuenta DIA/NOCHE/ECU_NOCHE; ADMINISTRATIVO y LIBRE no; resta ausentes; suma libres activados', () => {
    const r = calcularCapacidad({
      conductoresActivos: [1, 2, 3, 4, 5, 6],
      turnos: new Map([
        [1, 'DIA'],
        [2, 'NOCHE'],
        [3, 'ECU_NOCHE'],
        [4, 'ADMINISTRATIVO'],
        [5, 'LIBRE'],
      ]),
      ausentes: new Set([2]),
      activados: new Set([5, 6, 1]),
      vehiculosActivos: [10, 11, 12],
      enTaller: new Set([11, 99]),
    });

    expect(r.detalle).toEqual({
      conductoresConTurno: 3,
      conductoresAusentes: 1,
      // 5 (LIBRE activado) y 6 (sin turno, activado) suman; 1 ya contaba por su turno.
      libresActivados: 2,
      flota: 3,
      enTaller: 1,
    });
    expect(r.calculada).toEqual({ conductoresHabiles: 4, vehiculosHabiles: 2 });
  });

  it('un libre activado que además está ausente no suma', () => {
    const r = calcularCapacidad({
      conductoresActivos: [1],
      turnos: new Map(),
      ausentes: new Set([1]),
      activados: new Set([1]),
      vehiculosActivos: [],
      enTaller: new Set(),
    });
    expect(r.calculada.conductoresHabiles).toBe(0);
  });
});
