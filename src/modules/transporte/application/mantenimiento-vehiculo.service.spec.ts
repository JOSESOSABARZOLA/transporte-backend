/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Mantenimiento de vehículos
 * Archivo: mantenimiento-vehiculo.service.spec.ts
 * Responsabilidad: Verificar RN-DAF-05 y el no solapamiento de paradas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * LO QUE ESTAS PRUEBAS PROTEGEN es que una parada de taller no se pueda registrar dos
 * veces sobre las mismas fechas. Sin esa regla, «¿hasta cuándo está parado?» quedaría
 * decidido por el orden en que se consulten las filas, que es la peor forma de decidirlo.
 */

import { AccionAuditoria } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { FlotaRepository } from '../infrastructure/flota.repository';
import { MantenimientoVehiculoService } from './mantenimiento-vehiculo.service';

const VEHICULO = {
  id: 80,
  placa: 'PMA7056',
  descripcion: null,
  activo: true,
};

const dia = (numero: number) => new Date(Date.UTC(2026, 8, numero));

const parada = (desde: number, hasta: number, id = 1) => ({
  id,
  vehiculoId: 80,
  desde: dia(desde),
  hasta: dia(hasta),
  taller: 'AMBACAR',
  hora: '08:00',
  motivo: 'Cambio de frenos',
});

const armar = (
  opciones: {
    vehiculo?: Record<string, unknown> | null;
    cruces?: Record<string, unknown>[];
    existente?: Record<string, unknown> | null;
  } = {},
) => {
  const {
    vehiculo = VEHICULO,
    cruces = [],
    existente = parada(1, 3),
  } = opciones;

  const crearMantenimiento = jest
    .fn()
    .mockImplementation((datos: Record<string, unknown>) =>
      Promise.resolve({ id: 99, ...datos }),
    );
  const eliminarMantenimiento = jest.fn().mockResolvedValue(undefined);
  const registrar = jest.fn().mockResolvedValue(undefined);

  const flota = {
    buscarVehiculo: jest.fn().mockResolvedValue(vehiculo),
    listarMantenimientos: jest.fn().mockResolvedValue([parada(1, 3)]),
    mantenimientosQueSolapan: jest.fn().mockResolvedValue(cruces),
    buscarMantenimiento: jest.fn().mockResolvedValue(existente),
    crearMantenimiento,
    eliminarMantenimiento,
    // La transacción se ejecuta de inmediato: lo que se prueba es qué se escribe, no
    // cómo Prisma la abre.
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion({}),
      ),
  };

  const servicio = new MantenimientoVehiculoService(
    flota as unknown as FlotaRepository,
    { registrar } as unknown as AuditoriaService,
    { log: jest.fn() } as unknown as LoggerService,
  );

  return {
    servicio,
    flota,
    crearMantenimiento,
    eliminarMantenimiento,
    registrar,
  };
};

const capturar = async (promesa: Promise<unknown>): Promise<unknown> =>
  promesa.catch((error: unknown) => error);

describe('RN-DAF-05 · registrar una parada de taller', () => {
  it('guarda el taller, la hora y el motivo', async () => {
    const { servicio, crearMantenimiento } = armar();

    await servicio.registrar(
      80,
      {
        desde: dia(10),
        hasta: dia(12),
        taller: 'AMBACAR',
        hora: '08:00',
        motivo: 'Cambio de frenos',
      },
      4,
    );

    expect(crearMantenimiento).toHaveBeenCalledWith(
      expect.objectContaining({
        vehiculoId: 80,
        taller: 'AMBACAR',
        hora: '08:00',
        motivo: 'Cambio de frenos',
        registradoPor: 4,
      }),
      expect.anything(),
    );
  });

  /** Los tres datos nuevos son opcionales: una avería se registra antes de saberlos. */
  it('sin taller, hora ni motivo se registra igual, con nulos explícitos', async () => {
    const { servicio, crearMantenimiento } = armar();

    await servicio.registrar(80, { desde: dia(10), hasta: dia(12) }, 4);

    expect(crearMantenimiento).toHaveBeenCalledWith(
      expect.objectContaining({ taller: null, hora: null, motivo: null }),
      expect.anything(),
    );
  });

  it('queda auditado como creación, con quien lo registró', async () => {
    const { servicio, registrar } = armar();

    await servicio.registrar(80, { desde: dia(10), hasta: dia(12) }, 4);

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_disponibilidad',
        accion: AccionAuditoria.CREAR,
        usuario: 4,
      }),
      expect.anything(),
    );
  });

  it('un vehículo inexistente produce 404 y no escribe', async () => {
    const { servicio, crearMantenimiento } = armar({ vehiculo: null });

    const fallo = await capturar(
      servicio.registrar(80, { desde: dia(10), hasta: dia(12) }, 4),
    );

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
    expect(crearMantenimiento).not.toHaveBeenCalled();
  });

  it('la fecha de fin anterior a la de inicio se rechaza antes de tocar la base', async () => {
    const { servicio, crearMantenimiento } = armar();

    const fallo = await capturar(
      servicio.registrar(80, { desde: dia(12), hasta: dia(10) }, 4),
    );

    expect(fallo).toBeInstanceOf(ValidacionError);
    expect(crearMantenimiento).not.toHaveBeenCalled();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL NO SOLAPAMIENTO. Es INV-14 aplicado a un activo en lugar de a una persona.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
describe('RN-DAF-05 · dos paradas del mismo vehículo no se cruzan', () => {
  it('una parada que se cruza se rechaza nombrando las fechas ocupadas', async () => {
    const { servicio, crearMantenimiento } = armar({
      cruces: [parada(9, 14, 7)],
    });

    const fallo = await capturar(
      servicio.registrar(80, { desde: dia(10), hasta: dia(12) }, 4),
    );

    expect(fallo).toBeInstanceOf(ReglaNegocioError);
    expect((fallo as ReglaNegocioError).code).toBe('VEHICULO_OCUPADO');
    // El mensaje llega íntegro al funcionario: nombra la placa y el período que estorba.
    expect((fallo as ReglaNegocioError).message).toContain('PMA7056');
    expect((fallo as ReglaNegocioError).message).toContain('2026-09-09');
    expect(crearMantenimiento).not.toHaveBeenCalled();
  });

  it('la comprobación se pide al repositorio con el rango que se pretende', async () => {
    const { servicio, flota } = armar();

    await servicio.registrar(80, { desde: dia(10), hasta: dia(12) }, 4);

    expect(flota.mantenimientosQueSolapan).toHaveBeenCalledWith(
      80,
      dia(10),
      dia(12),
    );
  });
});

describe('RN-DAF-05 · retirar una parada', () => {
  it('la borra y deja la traza de quién lo hizo', async () => {
    const { servicio, eliminarMantenimiento, registrar } = armar();

    await servicio.retirar(7, 4);

    expect(eliminarMantenimiento).toHaveBeenCalledWith(7, expect.anything());
    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_disponibilidad',
        entidadId: 7,
        accion: AccionAuditoria.ELIMINAR,
        usuario: 4,
      }),
      expect.anything(),
    );
  });

  it('retirar una que no existe produce 404 y no borra nada', async () => {
    const { servicio, eliminarMantenimiento } = armar({ existente: null });

    const fallo = await capturar(servicio.retirar(7, 4));

    expect(fallo).toBeInstanceOf(RecursoNoEncontradoError);
    expect(eliminarMantenimiento).not.toHaveBeenCalled();
  });
});
