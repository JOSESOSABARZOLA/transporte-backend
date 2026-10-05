/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.service.spec.ts
 * Responsabilidad: Verificar la declaración y la comparación con la demanda.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 */

import { AccionAuditoria, RolDepartamental } from '@prisma/client';

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import type { LoggerService } from '../../../common/logger/logger.service';
import type { CuadroDiarioService } from '../../cuadro-diario/application/cuadro-diario.service';
import type { OperativosService } from '../../operativos/application/operativos.service';
import type {
  CapacidadFlotaRepository,
  DatosCapacidad,
} from '../infrastructure/capacidad-flota.repository';
import { CapacidadFlotaService } from './capacidad-flota.service';

const CLIENTE = { marca: 'transaccion' };
const JORNADA = new Date(Date.UTC(2027, 0, 20));
const DAF = { usuarioId: 4, rol: RolDepartamental.DAF };

const capacidad = (vehiculosHabiles = 15, conductoresHabiles = 15) => ({
  id: 300,
  cuadroId: 9,
  fecha: JORNADA,
  vehiculosHabiles,
  conductoresHabiles,
  observacion: null,
  declaradoPor: 4,
  declaradoEn: new Date(),
});

const armar = (
  opciones: {
    declarada?: ReturnType<typeof capacidad> | null;
    demanda?: number;
    sinCuadro?: Error;
  } = {},
) => {
  const { declarada = null, demanda = 0, sinCuadro } = opciones;

  /** Lo que el servicio pidió guardar, con tipo, para poder afirmar sobre ello. */
  const declaraciones: DatosCapacidad[] = [];

  let guardada = declarada;

  const declarar = jest.fn().mockImplementation((datos: DatosCapacidad) => {
    declaraciones.push(datos);
    guardada = {
      ...capacidad(datos.vehiculosHabiles, datos.conductoresHabiles),
      observacion: datos.observacion,
    };
    return Promise.resolve(guardada);
  });

  const buscarPorFecha = jest
    .fn()
    .mockImplementation(() => Promise.resolve(guardada));
  const contarDemandaDeTransporte = jest.fn().mockResolvedValue(demanda);
  const obtenerPorFecha = jest
    .fn()
    .mockImplementation(() =>
      sinCuadro
        ? Promise.reject(sinCuadro)
        : Promise.resolve({ id: 9, fecha: JORNADA }),
    );
  const registrar = jest.fn().mockResolvedValue(undefined);
  const compararCambios = jest
    .fn()
    .mockReturnValue([{ campo: 'capa_vehiculos_habiles', valorNuevo: '20' }]);
  const log = jest.fn();
  const warn = jest.fn();

  const servicio = new CapacidadFlotaService(
    {
      buscarPorFecha,
      declarar,
      ejecutarEnTransaccion: jest
        .fn()
        .mockImplementation((operacion: (c: unknown) => Promise<unknown>) =>
          operacion(CLIENTE),
        ),
    } as unknown as CapacidadFlotaRepository,
    { obtenerPorFecha } as unknown as CuadroDiarioService,
    { contarDemandaDeTransporte } as unknown as OperativosService,
    { registrar, compararCambios } as unknown as AuditoriaService,
    { log, warn } as unknown as LoggerService,
  );

  return {
    servicio,
    declarar,
    declaraciones,
    registrar,
    contarDemandaDeTransporte,
    log,
    warn,
  };
};

describe('CapacidadFlotaService · consulta', () => {
  it('sin declaración devuelve la demanda y ningún veredicto', async () => {
    const { servicio } = armar({ demanda: 7 });

    const estado = await servicio.verificarDemanda(JORNADA);

    expect(estado.declarada).toBeNull();
    expect(estado.vehiculosRequeridos).toBe(7);
    // Sin declaración no hay contra qué comparar: no se inventa un cero.
    expect(estado.veredicto).toBeNull();
  });

  it('caso 2 del plan · con 15 declarados y 12 requeridos, sin advertencia', async () => {
    const { servicio } = armar({ declarada: capacidad(15, 15), demanda: 12 });

    const estado = await servicio.verificarDemanda(JORNADA);

    expect(estado.veredicto?.hayAdvertencia).toBe(false);
    expect(estado.veredicto?.vehiculos.excedente).toBe(3);
  });

  it('caso 1 del plan · con 15 declarados y 18 requeridos, advertencia', async () => {
    const { servicio } = armar({ declarada: capacidad(15, 15), demanda: 18 });

    const estado = await servicio.verificarDemanda(JORNADA);

    expect(estado.veredicto?.hayAdvertencia).toBe(true);
    expect(estado.veredicto?.advertencia).toContain('3 vehículos');
  });

  it('consultar un día sin jornada abierta no falla: la demanda es cero', async () => {
    const { servicio, contarDemandaDeTransporte } = armar({ demanda: 0 });

    const estado = await servicio.verificarDemanda(JORNADA);

    expect(estado.vehiculosRequeridos).toBe(0);
    expect(contarDemandaDeTransporte).toHaveBeenCalledWith(JORNADA);
  });
});

describe('CapacidadFlotaService · declaración', () => {
  it('declara y devuelve el estado ya comparado', async () => {
    const { servicio, declaraciones } = armar({ demanda: 10 });

    const estado = await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 15, conductoresHabiles: 15 },
      DAF,
    );

    expect(declaraciones[0]).toEqual({
      cuadroId: 9,
      fecha: JORNADA,
      vehiculosHabiles: 15,
      conductoresHabiles: 15,
      observacion: null,
      declaradoPor: 4,
    });
    expect(estado.veredicto?.hayAdvertencia).toBe(false);
  });

  it('caso 4 del plan · la segunda declaración actualiza y se audita como cambio', async () => {
    const { servicio, registrar } = armar({
      declarada: capacidad(10, 10),
      demanda: 5,
    });

    await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 20, conductoresHabiles: 20 },
      DAF,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_capacidad_flota',
        accion: AccionAuditoria.ACTUALIZAR,
        cambios: [{ campo: 'capa_vehiculos_habiles', valorNuevo: '20' }],
      }),
      CLIENTE,
    );
  });

  it('la primera declaración se audita como CREAR, sin lista de cambios', async () => {
    const { servicio, registrar } = armar();

    await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 15, conductoresHabiles: 15 },
      DAF,
    );

    expect(registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: AccionAuditoria.CREAR,
        cambios: undefined,
      }),
      CLIENTE,
    );
  });

  it('sin cuadro abierto para esa fecha, no se declara', async () => {
    const sinJornada = new RecursoNoEncontradoError('no hay cuadro', {});
    const { servicio, declarar } = armar({ sinCuadro: sinJornada });

    await expect(
      servicio.declarar(
        JORNADA,
        { vehiculosHabiles: 15, conductoresHabiles: 15 },
        DAF,
      ),
    ).rejects.toBe(sinJornada);
    expect(declarar).not.toHaveBeenCalled();
  });

  it('recorta la observación y descarta la que queda vacía', async () => {
    const { servicio, declaraciones } = armar();

    await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 1, conductoresHabiles: 1, observacion: '   ' },
      DAF,
    );

    expect(declaraciones[0].observacion).toBeNull();
  });

  it('RN-46 · emite el aviso cuando la demanda supera lo declarado', async () => {
    const { servicio, warn } = armar({ demanda: 18 });

    const estado = await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 15, conductoresHabiles: 15 },
      DAF,
    );

    // Advierte y **devuelve el estado**: la declaración se guardó igualmente.
    expect(warn).toHaveBeenCalledWith(
      'Capacidad de flota excedida',
      expect.objectContaining({ vehiculosRequeridos: 18 }),
    );
    expect(estado.declarada?.vehiculosHabiles).toBe(15);
  });

  it('cuando alcanza, no emite el aviso', async () => {
    const { servicio, warn, log } = armar({ demanda: 5 });

    await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 15, conductoresHabiles: 15 },
      DAF,
    );

    expect(warn).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      'Capacidad de flota declarada',
      expect.anything(),
    );
  });

  it('declarar cero hábiles es válido: no es lo mismo que no declarar', async () => {
    const { servicio } = armar({ demanda: 0 });

    const estado = await servicio.declarar(
      JORNADA,
      { vehiculosHabiles: 0, conductoresHabiles: 0 },
      DAF,
    );

    expect(estado.declarada).not.toBeNull();
    expect(estado.veredicto?.hayAdvertencia).toBe(false);
  });
});
