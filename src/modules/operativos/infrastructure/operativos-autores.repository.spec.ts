/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos-autores.repository.spec.ts
 * Responsabilidad: Fijar que el nombre de quien firma las notas sale de UNA consulta por lote.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * Plan «acciones-icono-notas» (N3): `oobs_creado_por` y `oper_compartir_solicitado_por` no tienen
 * FK (como `oper_creado_por`), así que no hay relación que incluir. Una consulta por fila sería el
 * N+1 que la tabla de Mis operativos no puede pagar con un rango de días.
 */

import type { PrismaService } from '../../../prisma/prisma.service';
import { OperativosRepository } from './operativos.repository';

const operativo = (parcial: Record<string, unknown>) =>
  ({
    id: 1,
    creadoPor: 10,
    compartirConId: null,
    compartirSolicitadoPor: null,
    observaciones: [],
    ...parcial,
  }) as never;

const montar = (usuarios: { id: number; nombre: string }[] = []) => {
  const findMany = jest.fn().mockResolvedValue(usuarios);
  const repositorio = new OperativosRepository({
    usuario: { findMany },
  } as unknown as PrismaService);
  return { repositorio, findMany };
};

describe('OperativosRepository · conAutores (2026-10-19)', () => {
  it('una sola consulta para todo el lote, con los firmantes de las notas y de la solicitud', async () => {
    const { repositorio, findMany } = montar([
      { id: 10, nombre: 'ANA PÉREZ' },
      { id: 11, nombre: 'LUIS MORA' },
    ]);

    const conAutores = await repositorio.conAutores([
      operativo({ observaciones: [{ creadoPor: 10 }, { creadoPor: 11 }] }),
      operativo({
        id: 2,
        compartirConId: 1,
        compartirSolicitadoPor: 11,
        observaciones: [{ creadoPor: 10 }],
      }),
    ]);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [10, 11] } },
      select: { id: true, nombre: true },
    });
    expect((conAutores[1] as { autores: unknown }).autores).toEqual({
      10: 'ANA PÉREZ',
      11: 'LUIS MORA',
    });
  });

  it('sin notas ni solicitud no consulta nada', async () => {
    const { repositorio, findMany } = montar();

    await repositorio.conAutores([operativo({})]);

    expect(findMany).not.toHaveBeenCalled();
  });

  it('una solicitud sin firmante guardado toma al creador del operativo', async () => {
    const { repositorio, findMany } = montar();

    await repositorio.conAutores([operativo({ compartirConId: 5 })]);

    expect(findMany).toHaveBeenCalledWith({
      where: { id: { in: [10] } },
      select: { id: true, nombre: true },
    });
  });
});
