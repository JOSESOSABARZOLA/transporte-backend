/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Transporte requerido
 * Archivo: operativo-transporte.dto.spec.ts
 * Responsabilidad: Fijar que el tipo de transporte y el macrooperativo se validan al registrar y editar.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import {
  ActualizarOperativoDto,
  CrearAdicionalDto,
  CrearOperativoDto,
  EditarPatrullaDto,
} from './operativo.dto';

const propiedadesConError = async (
  clase: new () => object,
  cuerpo: Record<string, unknown>,
): Promise<string[]> => {
  const fallos = await validate(plainToInstance(clase, cuerpo), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return fallos.map((fallo) => fallo.property);
};

describe('Transporte requerido · DTO (2026-10-07)', () => {
  it.each([
    ['CrearOperativoDto', CrearOperativoDto],
    ['CrearAdicionalDto', CrearAdicionalDto],
    ['ActualizarOperativoDto', ActualizarOperativoDto],
    ['EditarPatrullaDto', EditarPatrullaDto],
  ] as const)(
    '%s rechaza un tipo de transporte fuera del enumerado',
    async (_nombre, clase) => {
      expect(
        await propiedadesConError(clase, { tipoTransporte: 'MEDIO_CAMINO' }),
      ).toContain('tipoTransporte');
    },
  );

  it.each([
    'COMPLETO',
    'SOLO_INICIO',
    'SOLO_FIN',
    'INICIO_Y_FIN',
    'PROPIOS_MEDIOS',
  ])('ActualizarOperativoDto admite %s', async (tipo) => {
    expect(
      await propiedadesConError(ActualizarOperativoDto, {
        version: 1,
        tipoTransporte: tipo,
      }),
    ).not.toContain('tipoTransporte');
  });

  it('el macrooperativo y la confirmación de liberar son booleanos', async () => {
    const errores = await propiedadesConError(ActualizarOperativoDto, {
      version: 1,
      esMacrooperativo: 'si',
      confirmarLiberacion: 'si',
    });
    expect(errores).toEqual(
      expect.arrayContaining(['esMacrooperativo', 'confirmarLiberacion']),
    );
  });

  it('confirmarLiberacion se admite en la edición de patrulla', async () => {
    expect(
      await propiedadesConError(EditarPatrullaDto, {
        confirmarLiberacion: true,
      }),
    ).not.toContain('confirmarLiberacion');
  });
});
