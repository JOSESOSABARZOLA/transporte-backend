/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · operación diaria de la flota (Fase 5)
 * Archivo: operacion-flota.service.spec.ts
 * Responsabilidad: Verificar el checklist, que el kilometraje no retrocede y los montos de los vales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { OperacionFlotaRepository } from '../infrastructure/operacion-flota.repository';
import { OperacionFlotaService } from './operacion-flota.service';

const HOY = new Date(Date.UTC(2026, 9, 14));
const AYER = new Date(Date.UTC(2026, 9, 13));

const armar = (
  opciones: {
    anterior?: { fecha: Date; kilometraje: number } | null;
    vehiculo?: unknown;
  } = {},
) => {
  const repositorio = {
    existeVehiculo: jest
      .fn()
      .mockResolvedValue(
        opciones.vehiculo === undefined
          ? { id: 10, placa: 'PMA0010', kilometraje: 1000 }
          : opciones.vehiculo,
      ),
    existeConductor: jest.fn().mockResolvedValue({ id: 3 }),
    lecturaAnterior: jest.fn().mockResolvedValue(opciones.anterior ?? null),
    guardarChecklist: jest.fn().mockResolvedValue({ id: 1, fecha: HOY }),
    guardarKilometraje: jest.fn().mockResolvedValue({ id: 2, fecha: HOY }),
    subirKilometrajeFicha: jest.fn().mockResolvedValue(undefined),
    crearVale: jest.fn().mockResolvedValue({ id: 3, fecha: HOY }),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };
  const registrar = jest.fn().mockResolvedValue(undefined);
  const servicio = new OperacionFlotaService(
    repositorio as unknown as OperacionFlotaRepository,
    { registrar } as unknown as AuditoriaService,
  );
  return { servicio, repositorio, registrar };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('OperacionFlotaService · checklist (Art. 9)', () => {
  it('guarda los rubros y, con kilometraje de salida, también la lectura del día', async () => {
    const { servicio, repositorio, registrar } = armar();

    await servicio.registrarChecklist(
      {
        vehiculoId: 10,
        conductorId: 3,
        fecha: HOY,
        items: { llantas: true, luces: false },
        kilometrajeSalida: 1200,
      },
      7,
    );

    expect(repositorio.guardarChecklist).toHaveBeenCalledWith(
      expect.objectContaining({
        items: { llantas: true, luces: false },
        kilometrajeSalida: 1200,
        registradoPor: 7,
      }),
      expect.anything(),
    );
    expect(repositorio.guardarKilometraje).toHaveBeenCalled();
    expect(repositorio.subirKilometrajeFicha).toHaveBeenCalledWith(
      10,
      1200,
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalled();
  });

  it('sin rubros, o con un rubro que no es sí/no, se rechaza', async () => {
    const { servicio, repositorio } = armar();

    expect(
      await capturar(
        servicio.registrarChecklist(
          { vehiculoId: 10, conductorId: 3, fecha: HOY, items: {} },
          7,
        ),
      ),
    ).toBeInstanceOf(ValidacionError);
    expect(
      await capturar(
        servicio.registrarChecklist(
          {
            vehiculoId: 10,
            conductorId: 3,
            fecha: HOY,
            items: { llantas: 'bien' as unknown as boolean },
          },
          7,
        ),
      ),
    ).toBeInstanceOf(ValidacionError);
    expect(repositorio.guardarChecklist).not.toHaveBeenCalled();
  });
});

describe('OperacionFlotaService · kilometraje', () => {
  it('un odómetro no retrocede respecto de un día anterior', async () => {
    const { servicio, repositorio } = armar({
      anterior: { fecha: AYER, kilometraje: 5000 },
    });

    const error = await capturar(
      servicio.registrarKilometraje(
        { vehiculoId: 10, fecha: HOY, kilometraje: 4999 },
        7,
      ),
    );

    expect(error).toBeInstanceOf(ValidacionError);
    expect((error as Error).message).toContain('2026-10-13');
    expect(repositorio.guardarKilometraje).not.toHaveBeenCalled();
  });

  it('una lectura válida se guarda y sube la ficha del vehículo', async () => {
    const { servicio, repositorio } = armar({
      anterior: { fecha: AYER, kilometraje: 5000 },
    });

    await servicio.registrarKilometraje(
      { vehiculoId: 10, fecha: HOY, kilometraje: 5100 },
      7,
    );

    expect(repositorio.guardarKilometraje).toHaveBeenCalledWith(
      expect.objectContaining({
        vehiculoId: 10,
        kilometraje: 5100,
        conductorId: null,
      }),
      expect.anything(),
    );
    expect(repositorio.subirKilometrajeFicha).toHaveBeenCalledWith(
      10,
      5100,
      expect.anything(),
    );
  });

  it('un vehículo inexistente produce 404', async () => {
    const { servicio } = armar({ vehiculo: null });
    expect(
      await capturar(
        servicio.registrarKilometraje(
          { vehiculoId: 99, fecha: HOY, kilometraje: 1 },
          7,
        ),
      ),
    ).toBeInstanceOf(RecursoNoEncontradoError);
  });
});

describe('OperacionFlotaService · vales de combustible', () => {
  it('un vale de $15 se rechaza antes de tocar la base', async () => {
    const { servicio, repositorio } = armar();

    const error = await capturar(
      servicio.registrarVale(
        { conductorId: 3, vehiculoId: 10, fecha: HOY, monto: 15 },
        7,
      ),
    );

    expect(error).toBeInstanceOf(ValidacionError);
    expect((error as Error).message).toBe(
      'El vale de combustible solo puede ser de $10 o $20.',
    );
    expect(repositorio.crearVale).not.toHaveBeenCalled();
  });

  it('un vale de $20 se guarda y se audita', async () => {
    const { servicio, repositorio, registrar } = armar();

    await servicio.registrarVale(
      {
        conductorId: 3,
        vehiculoId: 10,
        fecha: HOY,
        monto: 20,
        numero: ' V-77 ',
      },
      7,
    );

    expect(repositorio.crearVale).toHaveBeenCalledWith(
      expect.objectContaining({ monto: 20, numero: 'V-77', registradoPor: 7 }),
      expect.anything(),
    );
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 't_vale_combustible' }),
      expect.anything(),
    );
  });
});
