/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.service.spec.ts
 * Responsabilidad: Verificar el upsert por clave natural, la revalidación y los turnos por el lote.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { PERMISO_KEY } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { SEMILLA_ROL_PERMISO } from '../../../common/roles/matriz-permisos';
import { CargaInicialController } from '../presentation/carga-inicial.controller';
import { CargaInicialService } from './carga-inicial.service';

const AUTOR = { usuarioId: 1, rol: 'ADMINISTRADOR' as const };

function montar() {
  const flota = {
    crearConductor: jest.fn().mockResolvedValue({ id: 10 }),
    actualizarConductor: jest.fn().mockResolvedValue({ id: 11 }),
    crearVehiculo: jest.fn().mockResolvedValue({ id: 20 }),
    actualizarVehiculo: jest.fn().mockResolvedValue({ id: 21 }),
    // Compara la placa normalizada (A1): «pma1234» encuentra a la PMA-1234 registrada.
    buscarVehiculoPorPlaca: jest.fn((placa: string) =>
      Promise.resolve(
        placa.toUpperCase().replace(/[s-]/g, '') === 'PMA1234'
          ? { id: 21, activo: true }
          : null,
      ),
    ),
    listarUbicaciones: jest
      .fn()
      .mockResolvedValue([{ id: 30, nombre: 'MATRIZ', activo: true }]),
    crearUbicacion: jest.fn().mockResolvedValue({ id: 31 }),
    actualizarUbicacion: jest.fn().mockResolvedValue({ id: 30 }),
  };
  const flotaRepositorio = {
    buscarConductorPorCedula: jest.fn((cedula: string) =>
      Promise.resolve(
        cedula === '1712345678' ? { id: 11, activo: true } : null,
      ),
    ),
  };
  const planificacion = {
    zonalesActivas: jest
      .fn()
      .mockResolvedValue([{ id: 3, nombre: 'CALDERÓN' }]),
  };
  const turnos = {
    editarLote: jest.fn().mockResolvedValue({
      aplicadas: 1,
      omitidas: [{ conductorId: 7, fecha: '2026-11-03', motivo: 'Ausencia.' }],
    }),
    previsualizarImportacion: jest.fn(),
  };
  const servicio = new CargaInicialService(
    flota as never,
    flotaRepositorio as never,
    planificacion as never,
    turnos as never,
  );
  return { servicio, flota, turnos };
}

describe('CargaInicialService.aplicar', () => {
  it('conductores: crea los nuevos, actualiza por cédula y omite las filas inválidas', async () => {
    const { servicio, flota } = montar();
    const r = await servicio.aplicar(
      'conductores',
      undefined,
      [
        {
          fila: 2,
          datos: {
            cedula: '1712345678',
            nombreCompleto: 'PÉREZ JUAN',
            telefono: null,
          },
        },
        {
          fila: 3,
          datos: {
            cedula: '1798765432',
            nombreCompleto: 'LÓPEZ ANA',
            patronRotacion: 'DNL',
          },
        },
        { fila: 4, datos: { cedula: '12', nombreCompleto: '' } },
      ],
      AUTOR,
    );
    expect(r.creados).toBe(1);
    expect(r.actualizados).toBe(1);
    expect(r.omitidos).toHaveLength(1);
    expect(r.omitidos[0].fila).toBe(4);
    expect(r.omitidos[0].motivo).toMatch(/diez dígitos/);
    // Al actualizar, una celda vacía no borra lo que ya tiene (sin `telefono: null`).
    expect(flota.actualizarConductor).toHaveBeenCalledWith(
      11,
      { nombreCompleto: 'PÉREZ JUAN' },
      1,
    );
    expect(flota.crearConductor).toHaveBeenCalledWith(
      expect.objectContaining({
        cedula: '1798765432',
        patronRotacion: 'DNL',
        parqueaderoAutorizado: false,
      }),
      1,
    );
  });

  it('un error de regla de una fila no detiene las demás', async () => {
    const { servicio, flota } = montar();
    flota.crearVehiculo.mockRejectedValueOnce(
      new ValidacionError('Ya existe un vehículo con esa placa.'),
    );
    const r = await servicio.aplicar(
      'vehiculos',
      undefined,
      [
        { fila: 2, datos: { placa: 'PMA1' } },
        { fila: 3, datos: { placa: 'PMA2', soatVencimiento: '2026-12-01' } },
      ],
      AUTOR,
    );
    expect(r).toEqual({
      creados: 1,
      actualizados: 0,
      omitidos: [
        {
          fila: 2,
          motivo: 'Ya existe un vehículo con esa placa.',
        },
      ],
    });
    expect(flota.crearVehiculo).toHaveBeenLastCalledWith(
      expect.objectContaining({
        placa: 'PMA2',
        soatVencimiento: new Date('2026-12-01T00:00:00.000Z'),
      }),
      1,
    );
  });

  it('vehículos: la placa del Excel encuentra la registrada aunque venga sin guion', async () => {
    const { servicio, flota } = montar();
    const r = await servicio.aplicar(
      'vehiculos',
      undefined,
      [{ fila: 2, datos: { placa: 'PMA-1234', kilometraje: 90000 } }],
      AUTOR,
    );
    expect(r).toEqual({ creados: 0, actualizados: 1, omitidos: [] });
    expect(flota.buscarVehiculoPorPlaca).toHaveBeenCalledWith('PMA-1234');
    expect(flota.actualizarVehiculo).toHaveBeenCalledWith(
      21,
      expect.objectContaining({ kilometraje: 90000 }),
      1,
    );
    expect(flota.crearVehiculo).not.toHaveBeenCalled();
  });

  it('garajes: upsert por nombre sin tildes; un garaje nuevo es autorizado y puede ir sin zonal', async () => {
    const { servicio, flota } = montar();
    const r = await servicio.aplicar(
      'garajes',
      undefined,
      [
        { fila: 2, datos: { nombre: 'Matriz', zonal: null } },
        { fila: 3, datos: { nombre: 'Garaje Norte', zonal: 'calderon' } },
      ],
      AUTOR,
    );
    expect(r).toEqual({ creados: 1, actualizados: 1, omitidos: [] });
    expect(flota.actualizarUbicacion).toHaveBeenCalledWith(
      30,
      { garajeAutorizado: true },
      1,
    );
    expect(flota.crearUbicacion).toHaveBeenCalledWith('Garaje Norte', 1, {
      zonalId: 3,
    });
  });

  it('turnos: van por el lote del mes; las celdas de otro mes o turno raro se omiten', async () => {
    const { servicio, turnos } = montar();
    const r = await servicio.aplicar(
      'turnos',
      '2026-11',
      [
        {
          fila: 5,
          datos: {
            conductorId: 7,
            celdas: [
              { fecha: '2026-11-02', turno: 'DIA' },
              { fecha: '2026-11-03', turno: 'NOCHE' },
              { fecha: '2026-12-01', turno: 'DIA' },
              { fecha: '2026-11-04', turno: 'VACACIONES' },
            ],
          },
        },
        { fila: 6, datos: { conductor: 'sin id' } },
      ],
      AUTOR,
    );
    expect(turnos.editarLote).toHaveBeenCalledWith(
      [
        { conductorId: 7, fecha: '2026-11-02', turno: 'DIA' },
        { conductorId: 7, fecha: '2026-11-03', turno: 'NOCHE' },
      ],
      AUTOR,
    );
    expect(r.creados).toBe(0);
    expect(r.actualizados).toBe(1);
    expect(r.omitidos.map((o) => o.fila)).toEqual([5, 5, 6, 5]);
  });

  it('turnos sin mes: 400', async () => {
    const { servicio } = montar();
    await expect(
      servicio.aplicar('turnos', undefined, [], AUTOR),
    ).rejects.toBeInstanceOf(ValidacionError);
  });
});

describe('permiso carga-inicial:administrar', () => {
  it('el controlador lo exige y en la semilla solo lo tiene el ADMINISTRADOR', () => {
    expect(Reflect.getMetadata(PERMISO_KEY, CargaInicialController)).toEqual([
      'carga-inicial:administrar',
    ]);
    expect(SEMILLA_ROL_PERMISO['carga-inicial:administrar']).toEqual([
      'ADMINISTRADOR',
    ]);
  });

  it('el ADMINISTRADOR_DAF administra parámetros (los DAF_, por alcance)', () => {
    expect(SEMILLA_ROL_PERMISO['parametros:administrar']).toContain(
      'ADMINISTRADOR_DAF',
    );
  });
});
