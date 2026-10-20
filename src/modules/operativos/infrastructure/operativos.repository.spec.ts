/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: operativos.repository.spec.ts
 * Responsabilidad: Fijar cómo se cuentan los operativos por formulario (el «N hoy» del registro).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * Una sola consulta agrupada con el MISMO filtro del listado: los activos, del día y visibles
 * para los roles. Si el conteo usara otro filtro, el «N hoy» del selector no coincidiría con
 * las filas de la tabla «Operativos de este formulario».
 */

import { RolDepartamental } from '@prisma/client';

import type { PrismaService } from '../../../prisma/prisma.service';
import { OperativosRepository } from './operativos.repository';

describe('OperativosRepository · conteo por formulario (2026-10-16)', () => {
  const FECHA = new Date(Date.UTC(2026, 9, 17));

  const montar = (
    grupos: { formularioId: number; _count: { _all: number } }[],
  ) => {
    const groupBy = jest.fn().mockResolvedValue(grupos);
    const repositorio = new OperativosRepository({
      operativo: { groupBy },
    } as unknown as PrismaService);
    return { repositorio, groupBy };
  };

  it('agrupa por formulario con el filtro del listado y devuelve un mapa id → total', async () => {
    const { repositorio, groupBy } = montar([
      { formularioId: 1, _count: { _all: 3 } },
      { formularioId: 8, _count: { _all: 1 } },
    ]);

    const conteo = await repositorio.contarPorFormulario({
      desde: FECHA,
      hasta: FECHA,
      visiblesPara: [RolDepartamental.DMIP_OPERATIVOS],
    });

    expect([...conteo]).toEqual([
      [1, 3],
      [8, 1],
    ]);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['formularioId'],
      where: {
        activo: true,
        cuadro: { fecha: { gte: FECHA, lte: FECHA } },
        OR: [
          { creadoPorRol: { in: [RolDepartamental.DMIP_OPERATIVOS] } },
          {
            formulario: {
              roles: {
                some: { rol: { in: [RolDepartamental.DMIP_OPERATIVOS] } },
              },
            },
          },
        ],
      },
      _count: { _all: true },
    });
  });

  it('con la jornada entera visible no acota por rol', async () => {
    const { repositorio, groupBy } = montar([]);

    const conteo = await repositorio.contarPorFormulario({
      desde: FECHA,
      hasta: FECHA,
      visiblesPara: null,
    });

    expect(conteo.size).toBe(0);
    expect(groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activo: true, cuadro: { fecha: { gte: FECHA, lte: FECHA } } },
      }),
    );
  });
});
