/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventana.dto.spec.ts
 * Responsabilidad: Fijar las validaciones del contrato de administración de ventanas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ActualizarVentanaDto } from './ventana.dto';

const errores = async (cuerpo: Record<string, unknown>): Promise<string[]> => {
  const resultado = await validate(
    plainToInstance(ActualizarVentanaDto, cuerpo),
  );
  return resultado.flatMap((error) => Object.values(error.constraints ?? {}));
};

describe('ActualizarVentanaDto', () => {
  it.each([
    ['16:30', '16:30'],
    ['17:00', '16:30'],
  ])('rechaza apertura %s con cierre %s', async (horaApertura, horaCierre) => {
    expect(await errores({ horaApertura, horaCierre })).toContain(
      'La hora de cierre debe ser posterior a la de apertura.',
    );
  });

  it('admite un cierre posterior a la apertura', async () => {
    expect(
      await errores({ horaApertura: '07:00', horaCierre: '16:30' }),
    ).toEqual([]);
  });

  it('admite el cierre sin apertura', async () => {
    expect(await errores({ horaApertura: null, horaCierre: '16:30' })).toEqual(
      [],
    );
  });

  it.each(['DIARIO', 'LABORABLE', 'SIN_RESTRICCION'])(
    'admite el tipo %s',
    async (tipo) => {
      expect(await errores({ tipo })).toEqual([]);
    },
  );

  it.each(['SEMANAL', 'INTERVALO', 'OTRO'])(
    'rechaza el tipo %s',
    async (tipo) => {
      expect(await errores({ tipo })).toContain(
        'El tipo de ventana admite estos valores: DIARIO, LABORABLE, SIN_RESTRICCION.',
      );
    },
  );
});
