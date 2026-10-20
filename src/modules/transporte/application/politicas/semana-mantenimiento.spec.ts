/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota · mantenimiento
 * Archivo: semana-mantenimiento.spec.ts
 * Responsabilidad: Verificar la vista semanal de vehículos parados.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import {
  componerSemana,
  diasDeSemana,
  disponibilidadDeFlota,
} from './semana-mantenimiento';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('componerSemana', () => {
  it('siete días desde la fecha indicada', () => {
    expect(diasDeSemana(d('2026-10-05'))).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
    ]);
  });

  it('marca los días cubiertos por la cita con su estado y motivo; los demás en null', () => {
    const semana = componerSemana(
      d('2026-10-05'),
      [
        { id: 1, placa: 'PMA1' },
        { id: 2, placa: 'PMA2' },
      ],
      [
        {
          vehiculoId: 1,
          desde: d('2026-10-06'),
          hasta: d('2026-10-07'),
          estadoMantenimiento: 'EN_TALLER',
          motivo: 'Frenos',
        },
        {
          vehiculoId: 1,
          desde: d('2026-10-10'),
          hasta: d('2026-10-10'),
          // Cita anterior a la Fase 5, sin estado: cuenta como PROGRAMADO.
          estadoMantenimiento: null,
          motivo: null,
        },
      ],
    );

    expect(semana[0].dias.map((x) => x.estado)).toEqual([
      null,
      'EN_TALLER',
      'EN_TALLER',
      null,
      null,
      'PROGRAMADO',
      null,
    ]);
    expect(semana[0].dias[1]).toEqual({
      fecha: '2026-10-06',
      estado: 'EN_TALLER',
      motivo: 'Frenos',
    });
    expect(semana[0].dias[5]).toEqual({
      fecha: '2026-10-10',
      estado: 'PROGRAMADO',
    });
    expect(semana[1].dias.every((x) => x.estado === null)).toBe(true);
  });
});

describe('disponibilidadDeFlota (2026-10-20, D3)', () => {
  const cita = (
    id: number,
    vehiculoId: number,
    desde: string,
    hasta: string,
    estadoMantenimiento: string | null,
    motivo: string | null = null,
  ) => ({
    id,
    vehiculoId,
    desde: d(desde),
    hasta: d(hasta),
    estadoMantenimiento,
    motivo,
    taller: null,
    hora: null,
  });

  it('disponible, en taller hasta su fin, de baja y LISTO que ya no cuenta', () => {
    const filas = disponibilidadDeFlota(
      d('2026-10-20'),
      [
        { id: 1, placa: 'PMA-1', activo: true },
        { id: 2, placa: 'PMA-2', activo: true },
        { id: 3, placa: 'PMA-3', activo: false },
        { id: 4, placa: 'PMA-4', activo: true },
      ],
      [
        cita(10, 2, '2026-10-19', '2026-10-23', 'EN_TALLER', 'Frenos'),
        cita(11, 3, '2026-10-20', '2026-10-20', 'PROGRAMADO'),
        cita(12, 4, '2026-10-18', '2026-10-21', 'LISTO'),
        cita(13, 1, '2026-10-25', '2026-10-27', null),
        // Fuera de la semana: no se pinta.
        cita(14, 1, '2026-10-28', '2026-10-29', null),
      ],
    );

    expect(filas.map((f) => f.disponibilidad)).toEqual([
      'DISPONIBLE',
      'EN_TALLER',
      'DE_BAJA',
      'DISPONIBLE',
    ]);
    expect(filas[1].enTaller).toEqual({
      hasta: '2026-10-23',
      motivo: 'Frenos',
    });
    expect(filas[2].enTaller).toBeNull();
    expect(filas[0].paradas.map((p) => p.id)).toEqual([13]);
    expect(filas[0].paradas[0].estado).toBe('PROGRAMADO');
    expect(filas[3].paradas[0].estado).toBe('LISTO');
  });
});
