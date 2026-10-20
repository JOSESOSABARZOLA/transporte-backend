/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.dto.spec.ts
 * Responsabilidad: Fijar la validación del acta en el fin del día, la simulación y la lista de vehículos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 */

import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ConfirmarVehiculosDto,
  EmitirHojasDto,
  HuecosConductorQueryDto,
  HuecosQueryDto,
} from './jornada-daf.dto';
import { GuardaFinalDto, OptimizarDto } from './planificacion.dto';

const errores = async (
  clase: new () => object,
  cuerpo: Record<string, unknown>,
): Promise<string[]> => {
  const fallos = await validate(plainToInstance(clase, cuerpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return fallos.map((fallo) => fallo.property);
};

describe('GuardaFinalDto · acta en el domicilio (Art. 8)', () => {
  it('DOMICILIO sin número de acta es 400', async () => {
    expect(
      await errores(GuardaFinalDto, {
        vehiculoId: 1,
        tipo: 'DOMICILIO',
        ubicacionId: null,
      }),
    ).toEqual(['actaNumero']);
  });

  it('DOMICILIO con número pasa; GARAJE no lo pide', async () => {
    expect(
      await errores(GuardaFinalDto, {
        vehiculoId: 1,
        tipo: 'DOMICILIO',
        ubicacionId: null,
        actaNumero: 'ACTA-1',
      }),
    ).toEqual([]);
    expect(
      await errores(GuardaFinalDto, {
        vehiculoId: 1,
        tipo: 'GARAJE',
        ubicacionId: 3,
      }),
    ).toEqual([]);
  });
});

describe('contratos de «Planificar el día»', () => {
  it('OptimizarDto admite simular', async () => {
    expect(
      await errores(OptimizarDto, { fecha: '2026-10-09', simular: true }),
    ).toEqual([]);
    expect(
      await errores(OptimizarDto, { fecha: '2026-10-09', simular: 'sí' }),
    ).toEqual(['simular']);
  });

  it('ConfirmarVehiculosDto exige una lista de ids', async () => {
    expect(await errores(ConfirmarVehiculosDto, { saleIds: [1, 2] })).toEqual(
      [],
    );
    expect(await errores(ConfirmarVehiculosDto, { saleIds: ['a'] })).toEqual([
      'saleIds',
    ]);
  });

  it('EmitirHojasDto: el conductor es opcional', async () => {
    expect(await errores(EmitirHojasDto, {})).toEqual([]);
    expect(await errores(EmitirHojasDto, { conductorId: 'x' })).toEqual([
      'conductorId',
    ]);
  });
});

describe('Consultas de horas libres (2026-10-14)', () => {
  it('una fecha que no existe en el calendario es 400', async () => {
    expect(
      await errores(HuecosConductorQueryDto, { fecha: '2026-02-30' }),
    ).toEqual(['fecha']);
    expect(
      await errores(HuecosConductorQueryDto, { fecha: '2026-10-14' }),
    ).toEqual([]);
  });

  it('los filtros llegan como texto de la query y se convierten; un id no válido es 400', async () => {
    expect(
      await errores(HuecosQueryDto, { conductorId: '7', zonalId: '3' }),
    ).toEqual([]);
    expect(await errores(HuecosQueryDto, { vehiculoId: 'x' })).toEqual([
      'vehiculoId',
    ]);
    expect(await errores(HuecosQueryDto, { conductorId: '0' })).toEqual([
      'conductorId',
    ]);
  });
});
