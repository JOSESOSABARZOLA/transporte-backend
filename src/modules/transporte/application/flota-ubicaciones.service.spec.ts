/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota · garajes y ubicaciones
 * Archivo: flota-ubicaciones.service.spec.ts
 * Responsabilidad: Verificar el nombre único, la zonal y la baja y reactivación de los garajes.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 */

import type { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  RecursoNoEncontradoError,
  ReglaNegocioError,
} from '../../../common/errors/errores-dominio';
import type { FlotaRepository } from '../infrastructure/flota.repository';
import { FlotaService } from './flota.service';
import type { ParametrosTransporteService } from './parametros-transporte.service';

const EXISTENTES = [
  { id: 1, nombre: 'MATRIZ' },
  { id: 3, nombre: 'CALDERÓN' },
];

const armar = () => {
  const crearUbicacion = jest.fn().mockImplementation((nombre: string) =>
    Promise.resolve({
      id: 9,
      nombre,
      activo: true,
      garajeAutorizado: false,
      zonalId: null,
      zonal: null,
    }),
  );
  const actualizarUbicacion = jest
    .fn()
    .mockImplementation((id: number, cambios: { nombre?: string }) =>
      Promise.resolve({
        id,
        nombre: cambios.nombre,
        activo: true,
        garajeAutorizado: true,
        zonalId: null,
        zonal: null,
      }),
    );
  const repositorio = {
    nombresDeUbicaciones: jest.fn().mockResolvedValue(EXISTENTES),
    existeZonal: jest
      .fn()
      .mockImplementation((id: number) => Promise.resolve(id !== 999)),
    crearUbicacion,
    actualizarUbicacion,
    buscarUbicacion: jest.fn().mockResolvedValue({
      id: 3,
      nombre: 'CALDERÓN',
      activo: true,
      garajeAutorizado: true,
      zonalId: 3,
      zonal: { id: 3, nombre: 'Zonal Calderón' },
    }),
    destinosParaBaja: jest.fn().mockResolvedValue([]),
    ejecutarEnTransaccion: jest
      .fn()
      .mockImplementation((op: (c: unknown) => Promise<unknown>) => op({})),
  };
  const auditoria = {
    registrar: jest.fn().mockResolvedValue(undefined),
    compararCambios: jest.fn().mockReturnValue([{ campo: 'ubic_nombre' }]),
  };
  const parametros = {
    leerKmMaximo: jest.fn().mockResolvedValue(999_999),
  };
  const servicio = new FlotaService(
    repositorio as unknown as FlotaRepository,
    auditoria as unknown as AuditoriaService,
    parametros as unknown as ParametrosTransporteService,
  );
  return { servicio, crearUbicacion, actualizarUbicacion, repositorio };
};

describe('FlotaService · nombre único de ubicación (2026-10-06)', () => {
  it('rechaza con 409 un nombre que ya existe sin distinguir tildes ni mayúsculas', async () => {
    const { servicio, crearUbicacion } = armar();

    const intento = servicio.crearUbicacion('  calderon ', 1);

    await expect(intento).rejects.toBeInstanceOf(ReglaNegocioError);
    await expect(intento).rejects.toMatchObject({
      statusCode: 409,
      code: CODIGOS_ERROR.NOMBRE_DUPLICADO,
      message: 'Ya existe una ubicación con ese nombre.',
    });
    expect(crearUbicacion).not.toHaveBeenCalled();
  });

  it('acepta un nombre nuevo', async () => {
    const { servicio, crearUbicacion } = armar();

    await servicio.crearUbicacion('Eloy Alfaro', 1);

    // Tal cual se escribió, sin mayúsculas forzadas (A3, 2026-10-15), y AUTORIZADO.
    expect(crearUbicacion).toHaveBeenCalledWith(
      'Eloy Alfaro',
      expect.anything(),
      { garajeAutorizado: true, zonalId: undefined },
    );
  });

  it('un garaje nuevo nace SIEMPRE autorizado (D2, 2026-10-14) y sin zonal es válido', async () => {
    const { servicio, crearUbicacion } = armar();

    await servicio.crearUbicacion('Bodega', 1, { zonalId: null });

    expect(crearUbicacion).toHaveBeenCalledWith('Bodega', expect.anything(), {
      garajeAutorizado: true,
      zonalId: null,
    });
  });

  it('guarda el nombre con trim y sin cambiar mayúsculas, al crear y al editar (A3)', async () => {
    const { servicio, crearUbicacion, actualizarUbicacion } = armar();

    await servicio.crearUbicacion('  Los   Pinos ', 1);
    expect(crearUbicacion).toHaveBeenCalledWith(
      'Los   Pinos',
      expect.anything(),
      expect.anything(),
    );

    await servicio.actualizarUbicacion(3, { nombre: ' Calderón Norte ' }, 1);
    expect(actualizarUbicacion).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ nombre: 'Calderón Norte' }),
      expect.anything(),
    );
  });

  it('guardarlo tal cual no abre la puerta a otra grafía: «matriz» choca con «MATRIZ»', async () => {
    const { servicio, crearUbicacion } = armar();

    await expect(servicio.crearUbicacion('Matriz', 1)).rejects.toMatchObject({
      code: CODIGOS_ERROR.NOMBRE_DUPLICADO,
    });
    await expect(servicio.crearUbicacion('calderon', 1)).rejects.toMatchObject({
      code: CODIGOS_ERROR.NOMBRE_DUPLICADO,
    });
    expect(crearUbicacion).not.toHaveBeenCalled();
  });

  it('una zonal inexistente es 404, al crear y al editar', async () => {
    const { servicio, crearUbicacion, actualizarUbicacion } = armar();

    await expect(
      servicio.crearUbicacion('Bodega', 1, { zonalId: 999 }),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    await expect(
      servicio.actualizarUbicacion(3, { zonalId: 999 }, 1),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    expect(crearUbicacion).not.toHaveBeenCalled();
    expect(actualizarUbicacion).not.toHaveBeenCalled();
  });

  it('al editar, renombrar a otro existente da 409; conservar el propio nombre no', async () => {
    const { servicio, actualizarUbicacion } = armar();

    await expect(
      servicio.actualizarUbicacion(3, { nombre: 'Matriz' }, 1),
    ).rejects.toMatchObject({ code: CODIGOS_ERROR.NOMBRE_DUPLICADO });

    await servicio.actualizarUbicacion(3, { nombre: 'Calderon' }, 1);
    expect(actualizarUbicacion).toHaveBeenCalled();
  });
});

describe('FlotaService · baja y reactivación del garaje (D2, 2026-10-14)', () => {
  it('dar de baja apaga activo Y autorizado; reactivar enciende los dos', async () => {
    const { servicio, actualizarUbicacion } = armar();

    await servicio.darDeBajaUbicacion(3, 1);
    expect(actualizarUbicacion).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ activo: false, garajeAutorizado: false }),
      expect.anything(),
    );

    await servicio.reactivarUbicacion(3, 1);
    expect(actualizarUbicacion).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ activo: true, garajeAutorizado: true }),
      expect.anything(),
    );
  });

  it('la baja guarda la fecha y el autor; reactivar los vacía (D1, 2026-10-20)', async () => {
    const { servicio, actualizarUbicacion, repositorio } = armar();

    await servicio.darDeBajaUbicacion(3, 7);
    expect(actualizarUbicacion).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ bajaEn: expect.any(Date) as Date, bajaPor: 7 }),
      expect.anything(),
    );

    repositorio.buscarUbicacion.mockResolvedValue({
      id: 3,
      nombre: 'CALDERÓN',
      activo: false,
      garajeAutorizado: false,
      zonalId: 3,
      zonal: { id: 3, nombre: 'Zonal Calderón' },
    });
    await servicio.reactivarUbicacion(3, 7);
    expect(actualizarUbicacion).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ bajaEn: null, bajaPor: null }),
      expect.anything(),
    );
  });

  it('un garaje donde duerme un vehículo desde hoy no se da de baja (409, D2)', async () => {
    const { servicio, actualizarUbicacion, repositorio } = armar();
    repositorio.destinosParaBaja.mockResolvedValue([
      { fecha: '2099-10-21', placa: 'PMA-7056' },
      { fecha: '2099-10-22', placa: 'PMA-7056' },
    ]);

    await expect(servicio.darDeBajaUbicacion(3, 1)).rejects.toMatchObject({
      code: CODIGOS_ERROR.RECURSO_CON_ASIGNACION,
      message:
        'El garaje CALDERÓN tiene vehículos que duermen ahí desde el 21/10/2099: PMA-7056. Cambie su destino en «Planificar el día» antes de darlo de baja.',
    });
    expect(actualizarUbicacion).not.toHaveBeenCalled();
  });

  it('un PATCH con solo «activo» arrastra la autorización', async () => {
    const { servicio, actualizarUbicacion } = armar();

    await servicio.actualizarUbicacion(3, { activo: false }, 1);
    expect(actualizarUbicacion).toHaveBeenLastCalledWith(
      3,
      expect.objectContaining({ activo: false, garajeAutorizado: false }),
      expect.anything(),
    );
  });
});
