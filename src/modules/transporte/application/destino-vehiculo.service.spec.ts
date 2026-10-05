/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Destino del vehículo
 * Archivo: destino-vehiculo.service.spec.ts
 * Responsabilidad: Verificar RN-DAF-03 y la exclusión entre zonal y domicilio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * LO QUE ESTAS PRUEBAS PROTEGEN es que un destino siempre tenga destino. `ck_destino_sujeto`
 * lo garantiza en la base; aquí se comprueba antes para que la DAF lea una frase en lugar
 * de un error del motor, y para que **las dos comprobaciones no diverjan**.
 */

import { AccionAuditoria } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { FlotaRepository } from '../infrastructure/flota.repository';
import { DestinoVehiculoService } from './destino-vehiculo.service';

const JORNADA = new Date(Date.UTC(2026, 8, 10));

const VEHICULO = { id: 80, placa: 'PMA7056', descripcion: null, activo: true };
const ZONAL = { id: 3, nombre: 'ELOY ALFARO', activo: true };

const armar = (
  opciones: {
    vehiculo?: Record<string, unknown> | null;
    ubicacion?: Record<string, unknown> | null;
    anterior?: Record<string, unknown> | null;
  } = {},
) => {
  const { vehiculo = VEHICULO, ubicacion = ZONAL, anterior = null } = opciones;

  const declararDestino = jest
    .fn()
    .mockImplementation((datos: Record<string, unknown>) =>
      Promise.resolve({ id: 55, ...datos }),
    );
  const registrar = jest.fn().mockResolvedValue(undefined);

  const flota = {
    buscarVehiculo: jest.fn().mockResolvedValue(vehiculo),
    buscarUbicacion: jest.fn().mockResolvedValue(ubicacion),
    buscarDestino: jest.fn().mockResolvedValue(anterior),
    destinosDeLaFecha: jest.fn().mockResolvedValue([]),
    declararDestino,
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };

  const servicio = new DestinoVehiculoService(
    flota as unknown as FlotaRepository,
    {
      registrar,
      compararCambios: jest.fn().mockReturnValue([{ campo: 'ubic_id' }]),
    } as unknown as AuditoriaService,
    { log: jest.fn() } as unknown as LoggerService,
  );

  return { servicio, flota, declararDestino, registrar };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('RN-DAF-03 · declarar el destino de un vehículo', () => {
  it('lo deja en una zonal', async () => {
    const { servicio, declararDestino } = armar();

    await servicio.declarar(80, JORNADA, { ubicacionId: 3 }, 4);

    expect(declararDestino).toHaveBeenCalledWith(
      expect.objectContaining({
        vehiculoId: 80,
        fecha: JORNADA,
        ubicacionId: 3,
        domicilio: false,
        registradoPor: 4,
      }),
      expect.anything(),
    );
  });

  /** RN-DAF-04. El conductor con parqueadero autorizado se lo lleva a casa. */
  it('o se lo lleva el conductor, y entonces no hay zonal', async () => {
    const { servicio, declararDestino } = armar();

    await servicio.declarar(80, JORNADA, { domicilio: true }, 4);

    expect(declararDestino).toHaveBeenCalledWith(
      expect.objectContaining({ ubicacionId: null, domicilio: true }),
      expect.anything(),
    );
  });

  /**
   * LA QUE DE VERDAD DISCRIMINA. Un destino sin destino no es un destino, y sin esta
   * comprobación la fila llegaría a la base para que `ck_destino_sujeto` la rechazara con
   * un mensaje del motor que la DAF no puede entender.
   */
  it('sin zonal y sin domicilio se rechaza antes de tocar la base', async () => {
    const { servicio, declararDestino } = armar();

    const fallo = await capturar(servicio.declarar(80, JORNADA, {}, 4));

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect((fallo as ValidacionError).message).toContain('zonal');
    expect(declararDestino).not.toHaveBeenCalled();
  });

  it('con zonal Y domicilio a la vez también se rechaza', async () => {
    const { servicio, declararDestino } = armar();

    const fallo = await capturar(
      servicio.declarar(80, JORNADA, { ubicacionId: 3, domicilio: true }, 4),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect(declararDestino).not.toHaveBeenCalled();
  });

  it('una zonal dada de baja no se admite', async () => {
    const { servicio, declararDestino } = armar({
      ubicacion: { ...ZONAL, activo: false },
    });

    const fallo = await capturar(
      servicio.declarar(80, JORNADA, { ubicacionId: 3 }, 4),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect(declararDestino).not.toHaveBeenCalled();
  });

  it('un vehículo inexistente produce 404', async () => {
    const { servicio, declararDestino } = armar({ vehiculo: null });

    const fallo = await capturar(
      servicio.declarar(80, JORNADA, { ubicacionId: 3 }, 4),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
    expect(declararDestino).not.toHaveBeenCalled();
  });
});

/**
 * Declarar dos veces deja el mismo resultado: es un `upsert` sobre
 * `uq_destino_vehi_fecha`. Corregir es volver a declarar, no borrar y crear.
 */
describe('RN-DAF-03 · volver a declarar corrige', () => {
  it('la primera vez se audita como creación', async () => {
    const { servicio, registrar } = armar({ anterior: null });

    await servicio.declarar(80, JORNADA, { ubicacionId: 3 }, 4);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_destino_vehiculo',
        accion: AccionAuditoria.CREAR,
      }),
      expect.anything(),
    );
  });

  it('la segunda como modificación, con el cambio en la traza', async () => {
    const { servicio, registrar } = armar({
      anterior: { id: 55, ubicacionId: 9, domicilio: false },
    });

    await servicio.declarar(80, JORNADA, { ubicacionId: 3 }, 4);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: AccionAuditoria.ACTUALIZAR,
        cambios: [{ campo: 'ubic_id' }],
      }),
      expect.anything(),
    );
  });
});
