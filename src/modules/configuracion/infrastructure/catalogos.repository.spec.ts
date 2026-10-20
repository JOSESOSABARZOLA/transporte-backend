/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos.repository.spec.ts
 * Responsabilidad: Fijar cómo se cuentan los usos de un tipo de control (defecto del 2026-10-12).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-12
 *
 * EL DEFECTO. Desde que los nueve formularios admiten varios tipos (2026-09-14) el operativo los
 * guarda en `t_operativo_tipo_control`, no en `tico_id`. Contar solo la columna decía «0
 * operativos» de tipos usados: la baja lo informaba mal y el borrado llegaba a la FK de la base
 * en lugar de al 409 con su motivo.
 */

import type { PrismaService } from '../../../prisma/prisma.service';
import { CatalogosRepository } from './catalogos.repository';

describe('CatalogosRepository · usos del tipo de control', () => {
  it('cuenta la columna única Y la tabla de varios tipos', async () => {
    const count = jest.fn().mockResolvedValue(3);
    const repositorio = new CatalogosRepository({
      operativo: { count },
    } as unknown as PrismaService);

    expect(await repositorio.contarOperativosConTipoControl(20)).toBe(3);
    expect(count).toHaveBeenCalledWith({
      where: {
        OR: [{ tipoControlId: 20 }, { tiposControl: { some: { tipoId: 20 } } }],
      },
    });
  });
});

describe('CatalogosRepository · zonales del formulario al registrar (2026-10-13)', () => {
  it('viajan con el id de la ZONA de la ciudad y el nombre que les dio el formulario', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 12,
        formularioId: 8,
        zonaId: 2,
        nombre: 'Zonal Norte',
        activo: true,
        orden: 2,
        zona: {
          id: 2,
          codigo: 'EUGENIO_ESPEJO',
          nombre: 'Zonal Eugenio Espejo',
          esDmq: false,
          orden: 2,
          activo: true,
          sector: null,
        },
      },
    ]);
    const repositorio = new CatalogosRepository({
      zonalFormulario: { findMany },
    } as unknown as PrismaService);

    const zonales = await repositorio.zonalesDeFormulario(8);

    // Transporte y la ficha de personal comparan por la ZONA: el id no cambia entre formularios.
    expect(zonales).toEqual([
      expect.objectContaining({
        id: 2,
        codigo: 'EUGENIO_ESPEJO',
        nombre: 'Zonal Norte',
      }),
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          formularioId: 8,
          activo: true,
          zona: { activo: true },
          puntos: { some: { activo: true } },
        },
      }),
    );
  });
});
