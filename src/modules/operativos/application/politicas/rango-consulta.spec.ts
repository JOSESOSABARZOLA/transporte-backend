/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Mis operativos · consulta por rango de fechas
 * Archivo: rango-consulta.spec.ts
 * Responsabilidad: Fijar los límites del rango, la zona horaria del cuadro vigente y la
 *                  edición por fila.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 */

import { EstadoCuadro } from '@prisma/client';

import { ValidacionError } from '../../../../common/errors/errores-dominio';
import {
  admiteEdicion,
  diasDelRango,
  fechaVigente,
  interpretarRangoMax,
  resolverRango,
  sumarDiasIso,
} from './rango-consulta';

describe('rango de «Mis operativos»', () => {
  describe('fechaVigente · mañana en America/Guayaquil', () => {
    it('a media mañana en Quito el vigente es el día siguiente', () => {
      expect(
        fechaVigente(new Date('2026-10-13T15:00:00Z'), 'America/Guayaquil'),
      ).toBe('2026-10-14');
    });

    it('a las 23H30 de Quito (ya es mañana en UTC) sigue siendo el día siguiente, no dos', () => {
      expect(
        fechaVigente(new Date('2026-10-14T04:30:00Z'), 'America/Guayaquil'),
      ).toBe('2026-10-14');
    });

    it('a las 00H05 de Quito avanza un día', () => {
      expect(
        fechaVigente(new Date('2026-10-14T05:05:00Z'), 'America/Guayaquil'),
      ).toBe('2026-10-15');
    });

    it('cruza el fin de mes y de año', () => {
      expect(sumarDiasIso('2026-12-31', 1)).toBe('2027-01-01');
    });
  });

  describe('resolverRango', () => {
    it('la fecha única equivale a desde = hasta (compatibilidad)', () => {
      expect(resolverRango({ fecha: '2026-10-14' }, 31)).toEqual({
        desde: '2026-10-14',
        hasta: '2026-10-14',
      });
    });

    it('sin fechas no filtra', () => {
      expect(resolverRango({}, 31)).toBeNull();
    });

    it('acepta exactamente el máximo y rechaza un día más', () => {
      expect(diasDelRango('2026-10-01', '2026-10-31')).toBe(31);
      expect(
        resolverRango({ desde: '2026-10-01', hasta: '2026-10-31' }, 31),
      ).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
      expect(() =>
        resolverRango({ desde: '2026-10-01', hasta: '2026-11-01' }, 31),
      ).toThrow('El rango no puede superar 31 días.');
    });

    it('rechaza «Hasta» anterior a «Desde»', () => {
      expect(() =>
        resolverRango({ desde: '2026-10-14', hasta: '2026-10-13' }, 31),
      ).toThrow('"Hasta" no puede ser anterior a "Desde".');
    });

    it('rechaza mezclar «fecha» con el rango y una sola fecha del rango', () => {
      expect(() =>
        resolverRango({ fecha: '2026-10-14', desde: '2026-10-14' }, 31),
      ).toThrow(ValidacionError);
      expect(() => resolverRango({ desde: '2026-10-14' }, 31)).toThrow(
        'Indique las dos fechas del rango: «desde» y «hasta».',
      );
    });

    it('rechaza una fecha que no existe', () => {
      expect(() =>
        resolverRango({ desde: '2026-02-30', hasta: '2026-03-01' }, 31),
      ).toThrow(ValidacionError);
    });
  });

  it('el parámetro inválido o ausente cae a 31', () => {
    expect(interpretarRangoMax('')).toBe(31);
    expect(interpretarRangoMax('0')).toBe(31);
    expect(interpretarRangoMax('60')).toBe(60);
  });

  describe('admiteEdicion', () => {
    const vigente = '2026-10-14';

    it('solo el cuadro vigente, no cerrado y con la ventana abierta', () => {
      expect(
        admiteEdicion(
          { cuadroFecha: vigente, cuadroEstado: EstadoCuadro.BORRADOR },
          vigente,
          true,
        ),
      ).toBe(true);
      expect(
        admiteEdicion(
          { cuadroFecha: vigente, cuadroEstado: EstadoCuadro.BORRADOR },
          vigente,
          false,
        ),
      ).toBe(false);
      expect(
        admiteEdicion(
          { cuadroFecha: '2026-10-13', cuadroEstado: EstadoCuadro.BORRADOR },
          vigente,
          true,
        ),
      ).toBe(false);
      expect(
        admiteEdicion(
          { cuadroFecha: vigente, cuadroEstado: EstadoCuadro.CERRADO },
          vigente,
          true,
        ),
      ).toBe(false);
    });
  });
});
