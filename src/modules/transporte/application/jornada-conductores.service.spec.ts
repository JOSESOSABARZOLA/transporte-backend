/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada de los conductores
 * Archivo: jornada-conductores.service.spec.ts
 * Responsabilidad: Verificar el encadenado y que los ausentes se muestren, no se oculten.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * LA PRUEBA QUE IMPORTA es la del encadenado: que un conductor con tres operativos los
 * traiga los tres. Es el hallazgo central del levantamiento —el 38 % de las asignaciones
 * reales encadenan más de un operativo— y el motivo de que este tablero exista.
 */

import type { FlotaRepository } from '../infrastructure/flota.repository';
import { JornadaConductoresService } from './jornada-conductores.service';

const JORNADA = new Date(Date.UTC(2026, 8, 10));

const conductor = (id: number, nombreCompleto: string, extra = {}) => ({
  id,
  nombreCompleto,
  sector: null,
  parqueaderoAutorizado: false,
  tipoContrato: null,
  ...extra,
});

const conduccion = (
  conductorId: number,
  identificador: string,
  horaInicio: string,
  horaFin: string,
  horas: number,
) => ({
  conductorId,
  identificador,
  horaInicio,
  horaFin,
  horas,
  esNocturno: false,
  placa: 'PMA7056',
  punto: 'AMC Matriz',
});

const armar = (
  opciones: {
    conductores?: Record<string, unknown>[];
    ausentes?: number[];
    conducciones?: Record<string, unknown>[];
  } = {},
) => {
  const {
    conductores = [conductor(10, 'VIVANCO JORGE')],
    ausentes = [],
    conducciones = [],
  } = opciones;

  const flota = {
    listarConductores: jest.fn().mockResolvedValue(conductores),
    conductoresAusentes: jest.fn().mockResolvedValue(new Set(ausentes)),
    conduccionesDeLaJornada: jest.fn().mockResolvedValue(conducciones),
  };

  return new JornadaConductoresService(flota as unknown as FlotaRepository);
};

describe('P-14 · la jornada encadenada del conductor', () => {
  it('un conductor sin nada asignado llega con la jornada vacía', async () => {
    const jornada = await armar().componer(JORNADA);

    expect(jornada).toHaveLength(1);
    expect(jornada[0].tramos).toEqual([]);
    expect(jornada[0].horasAcumuladas).toBe(0);
  });

  /**
   * EL CASO QUE JUSTIFICA EL TABLERO. El sistema modelaba «un operativo, un conductor»;
   * el Excel muestra 53 celdas del mes con tres o más rangos horarios.
   */
  it('un conductor con tres operativos los trae los tres, en orden', async () => {
    const servicio = armar({
      conducciones: [
        conduccion(10, 'PMO-001', '08:00', '10:00', 2),
        conduccion(10, 'PMO-007', '12:00', '14:00', 2),
        conduccion(10, 'PMO-011', '17:00', '18:30', 1.5),
      ],
    });

    const jornada = await servicio.componer(JORNADA);

    expect(jornada[0].tramos.map((tramo) => tramo.identificador)).toEqual([
      'PMO-001',
      'PMO-007',
      'PMO-011',
    ]);
  });

  it('suma las horas al volante del día', async () => {
    const servicio = armar({
      conducciones: [
        conduccion(10, 'PMO-001', '08:00', '10:00', 2),
        conduccion(10, 'PMO-007', '12:00', '14:00', 2.5),
      ],
    });

    const jornada = await servicio.componer(JORNADA);

    expect(jornada[0].horasAcumuladas).toBe(4.5);
  });

  it('el horario se escribe en formato institucional', async () => {
    const servicio = armar({
      conducciones: [conduccion(10, 'PMO-001', '08:00', '16:30', 8.5)],
    });

    const jornada = await servicio.componer(JORNADA);

    expect(jornada[0].tramos[0].horario).toBe('08H00 A 16H30');
  });

  it('reparte los operativos entre sus conductores, sin mezclarlos', async () => {
    const servicio = armar({
      conductores: [
        conductor(10, 'VIVANCO JORGE'),
        conductor(11, 'TORRES ANA'),
      ],
      conducciones: [
        conduccion(10, 'PMO-001', '08:00', '10:00', 2),
        conduccion(11, 'PMO-002', '09:00', '11:00', 2),
      ],
    });

    const jornada = await servicio.componer(JORNADA);

    expect(jornada[0].tramos).toHaveLength(1);
    expect(jornada[0].tramos[0].identificador).toBe('PMO-001');
    expect(jornada[1].tramos[0].identificador).toBe('PMO-002');
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOS AUSENTES SE MUESTRAN MARCADOS, y es lo contrario de `conductoresDisponibles`.
 *
 * Aquél arma un desplegable y excluye: ofrecer a alguien de vacaciones sería ofrecer lo
 * que después se rechaza. Éste es un TABLERO, y a la DAF le importa ver que cinco de sus
 * treinta y cuatro conductores están de vacaciones: es lo que explica por qué no le
 * alcanza la flota.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('P-14 · los conductores ausentes', () => {
  it('siguen apareciendo, marcados como no disponibles', async () => {
    const servicio = armar({
      conductores: [
        conductor(10, 'VIVANCO JORGE'),
        conductor(11, 'TORRES ANA'),
      ],
      ausentes: [11],
    });

    const jornada = await servicio.componer(JORNADA);

    expect(jornada).toHaveLength(2);
    expect(jornada[0].disponible).toBe(true);
    expect(jornada[1].disponible).toBe(false);
  });
});
