/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: semana-iso.spec.ts
 * Responsabilidad: Verificar el número de semana, sobre todo en el cambio de año.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { semanaIso } from './semana-iso';

const dia = (texto: string): Date => new Date(`${texto}T00:00:00.000Z`);

describe('semanaIso', () => {
  it('calcula una semana cualquiera del año', () => {
    // El 5 de agosto de 2026 es miércoles de la semana 32.
    expect(semanaIso(dia('2026-08-05'))).toEqual({ numero: 32, anio: 2026 });
  });

  it('la semana empieza en lunes y termina en domingo', () => {
    // Del lunes 3 al domingo 9 de agosto, todos son semana 32.
    for (const fecha of [
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
      '2026-08-08',
      '2026-08-09',
    ]) {
      expect(semanaIso(dia(fecha)).numero).toBe(32);
    }

    // El lunes siguiente ya es la 33.
    expect(semanaIso(dia('2026-08-10')).numero).toBe(33);
  });

  describe('caso 2 del plan · el cambio de año', () => {
    it('el 31 de diciembre de 2026 es la semana 53 de 2026', () => {
      // 2026-12-31 es jueves, así que su semana pertenece a 2026.
      expect(semanaIso(dia('2026-12-31'))).toEqual({ numero: 53, anio: 2026 });
    });

    it('el 1 de enero de 2027 SIGUE en la semana 53 de 2026', () => {
      // Es viernes: la misma semana que empezó el lunes 28 de diciembre.
      expect(semanaIso(dia('2027-01-01'))).toEqual({ numero: 53, anio: 2026 });
    });

    it('el 4 de enero de 2027 ya es la semana 1 de 2027', () => {
      expect(semanaIso(dia('2027-01-04'))).toEqual({ numero: 1, anio: 2027 });
    });

    it('el 1 de enero de 2026 es la semana 1 de 2026', () => {
      // Jueves: la semana contiene el primer jueves del año.
      expect(semanaIso(dia('2026-01-01'))).toEqual({ numero: 1, anio: 2026 });
    });

    it('el 31 de diciembre de 2025 pertenece a la semana 1 de 2026', () => {
      // El miércoles anterior a ese jueves: misma semana, año siguiente.
      expect(semanaIso(dia('2025-12-31'))).toEqual({ numero: 1, anio: 2026 });
    });

    it('el 31 de diciembre de 2024 es la semana 1 de 2025', () => {
      expect(semanaIso(dia('2024-12-31'))).toEqual({ numero: 1, anio: 2025 });
    });

    it('el 1 de enero de 2023 pertenece a la semana 52 de 2022', () => {
      // Domingo: última jornada de la semana anterior.
      expect(semanaIso(dia('2023-01-01'))).toEqual({ numero: 52, anio: 2022 });
    });
  });

  describe('años con 53 semanas', () => {
    it('2026 tiene 53 semanas y 2025 tiene 52', () => {
      expect(semanaIso(dia('2026-12-28')).numero).toBe(53);
      expect(semanaIso(dia('2025-12-29')).numero).toBe(1);
      expect(semanaIso(dia('2025-12-28')).numero).toBe(52);
    });
  });

  it('el número siempre está entre 1 y 53', () => {
    const fecha = new Date(Date.UTC(2026, 0, 1));

    for (let contador = 0; contador < 365 * 3; contador += 1) {
      const semana = semanaIso(fecha);
      expect(semana.numero).toBeGreaterThanOrEqual(1);
      expect(semana.numero).toBeLessThanOrEqual(53);
      fecha.setUTCDate(fecha.getUTCDate() + 1);
    }
  });

  it('se calcula en UTC: la fecha no se desplaza un día', () => {
    // Una fecha de calendario a medianoche UTC. Leerla en Guayaquil daría el día
    // anterior, y una jornada del lunes caería en la semana anterior.
    expect(semanaIso(new Date('2026-08-03T00:00:00.000Z')).numero).toBe(32);
  });
});
