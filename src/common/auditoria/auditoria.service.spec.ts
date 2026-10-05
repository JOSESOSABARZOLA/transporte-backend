/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Auditoría
 * Archivo: auditoria.service.spec.ts
 * Responsabilidad: Verificar la composición de la traza y el uso del cliente de
 *                  transacción, que es la garantía de DA-09.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { AccionAuditoria, RolDepartamental } from '@prisma/client';

import { ejecutarConContexto } from '../contexto/contexto-peticion';
import { AuditoriaService } from './auditoria.service';
import type { AuditoriaRepository } from './auditoria.repository';

describe('AuditoriaService', () => {
  const contexto = {
    correlacionId: 'corr-1',
    usuarioId: 7,
    rol: RolDepartamental.DMIP_OPERATIVOS,
    metodo: 'POST',
    ruta: '/api/v1/operativos',
  };

  const crearServicio = () => {
    const repositorio = {
      insertar: jest.fn().mockResolvedValue(undefined),
      insertarVarias: jest.fn().mockResolvedValue(undefined),
    };
    return {
      repositorio,
      servicio: new AuditoriaService(
        repositorio as unknown as AuditoriaRepository,
      ),
    };
  };

  it('toma la identidad y la correlación del contexto de la petición', async () => {
    const { servicio, repositorio } = crearServicio();

    await ejecutarConContexto(contexto, () =>
      servicio.registrar({
        entidad: 't_operativo',
        entidadId: 5120,
        accion: AccionAuditoria.CREAR,
      }),
    );

    expect(repositorio.insertar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 't_operativo',
        entidadId: 5120,
        accion: AccionAuditoria.CREAR,
        usuario: 7,
        rol: RolDepartamental.DMIP_OPERATIVOS,
        correlacion: 'corr-1',
      }),
      undefined,
    );
  });

  it('propaga el cliente de la transacción, que es lo que garantiza DA-09', async () => {
    const { servicio, repositorio } = crearServicio();
    const transaccion = { marca: 'cliente-de-transaccion' };

    await ejecutarConContexto(contexto, () =>
      servicio.registrar(
        { entidad: 't_operativo', entidadId: 1, accion: AccionAuditoria.CREAR },
        transaccion as never,
      ),
    );

    expect(repositorio.insertar).toHaveBeenCalledWith(
      expect.anything(),
      transaccion,
    );
  });

  it('rechaza auditar sin identidad: una traza anónima no es evidencia', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.registrar({
        entidad: 't_operativo',
        entidadId: 1,
        accion: AccionAuditoria.CREAR,
      }),
    ).rejects.toThrow(/identidad/i);
  });

  it('escribe una fila por campo modificado', async () => {
    const { servicio, repositorio } = crearServicio();

    await ejecutarConContexto(contexto, () =>
      servicio.registrar({
        entidad: 't_operativo',
        entidadId: 5120,
        accion: AccionAuditoria.ACTUALIZAR,
        cambios: [
          { campo: 'horaInicio', valorAnterior: '08:00', valorNuevo: '09:00' },
          { campo: 'horaFin', valorAnterior: '16:30', valorNuevo: '17:00' },
        ],
      }),
    );

    expect(repositorio.insertarVarias).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ campo: 'horaInicio' }),
        expect.objectContaining({ campo: 'horaFin' }),
      ]),
      undefined,
    );
    expect(repositorio.insertar).not.toHaveBeenCalled();
  });

  describe('compararCambios', () => {
    const { servicio } = crearServicio();

    it('devuelve solo los campos que cambiaron', () => {
      const cambios = servicio.compararCambios(
        { horaInicio: '08:00', horaFin: '16:30', puntoLibre: 'Tejar' },
        { horaInicio: '09:00', horaFin: '16:30', puntoLibre: 'Tejar' },
      );
      expect(cambios).toEqual([
        { campo: 'horaInicio', valorAnterior: '08:00', valorNuevo: '09:00' },
      ]);
    });

    it('detecta el paso de un valor a nulo', () => {
      const cambios = servicio.compararCambios(
        { conductorId: 302 },
        { conductorId: null },
      );
      expect(cambios).toEqual([
        { campo: 'conductorId', valorAnterior: '302', valorNuevo: undefined },
      ]);
    });

    it('no reporta cambio cuando el valor es equivalente', () => {
      expect(
        servicio.compararCambios({ secuencial: 4 }, { secuencial: 4 }),
      ).toEqual([]);
    });
  });
});
