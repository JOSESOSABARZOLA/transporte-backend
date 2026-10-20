/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: catalogos.repository.ts
 * Responsabilidad: Leer y administrar zonales, puntos, tipos de control e instituciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Único punto del submódulo que toca PrismaService para los catálogos.
 *
 * CADA CATÁLOGO PERTENECE A UN FORMULARIO: puntos, tipos de control e instituciones llevan su
 * `formularioId` propio (2026-09-29), y desde el 2026-10-13 también las ZONALES, en
 * `t_zonal_formulario`. `t_zonal` queda como la ZONA DE LA CIUDAD —la que usan el personal, la
 * flota y Transporte para reconocer el mismo sitio entre formularios—; la administración y el
 * registro trabajan con la zonal DEL formulario, que corresponde a una zona.
 */

import { Injectable } from '@nestjs/common';
import type {
  Institucion,
  Prisma,
  PuntoEncuentro,
  TipoControl,
  Zonal,
  ZonalFormulario,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/**
 * Punto de encuentro con su zona de la ciudad y con la zonal DE SU FORMULARIO, que es la que da
 * el nombre que ve ese formulario (2026-10-13).
 */
export type PuntoConZonal = Prisma.PuntoEncuentroGetPayload<{
  include: { zonal: true; zonalFormulario: true };
}>;

/** Un tipo de control pertenece a UN formulario por su `formularioId` directo. */
export type TipoControlDelimitado = TipoControl;

/** Una institución pertenece a UN formulario por su `formularioId` directo. */
export type InstitucionDelimitada = Institucion;

/** Catálogos de un formulario. */
export interface CatalogosDelimitados {
  puntos: PuntoConZonal[];
  tiposControl: TipoControlDelimitado[];
  instituciones: InstitucionDelimitada[];
}

/*
  LA LISTA DE ADMINISTRACIÓN TRAE LOS USOS EN LA MISMA CONSULTA (rediseño de P-08, 2026-10-12).
  `_count` de Prisma resuelve el conteo con una subconsulta por relación dentro del mismo
  `findMany`: la pantalla sabe qué se puede eliminar sin una consulta por fila.
*/
export type PuntoAdmin = Prisma.PuntoEncuentroGetPayload<{
  include: {
    zonal: true;
    zonalFormulario: true;
    _count: { select: { operativos: true } };
  };
}>;

/** El tipo se usa por su columna única (`tico_id`) o por la tabla de varios tipos. */
export type TipoControlAdmin = Prisma.TipoControlGetPayload<{
  include: {
    _count: { select: { operativos: true; operativosMultiples: true } };
  };
}>;

export type InstitucionAdmin = Prisma.InstitucionGetPayload<{
  include: { _count: { select: { operativos: true } } };
}>;

export interface CatalogosAdmin {
  puntos: PuntoAdmin[];
  tiposControl: TipoControlAdmin[];
  instituciones: InstitucionAdmin[];
}

/** Una zonal de formulario con su zona de la ciudad. */
export type ZonalDeFormulario = Prisma.ZonalFormularioGetPayload<{
  include: { zona: true };
}>;

/**
 * La zonal del formulario con la forma que espera el registro: el id es el de la ZONA —lo que
 * guardan el operativo y la ficha de personal—, y el nombre y el estado, los del formulario.
 */
export const comoZonal = (fila: ZonalDeFormulario): Zonal => ({
  ...fila.zona,
  nombre: fila.nombre,
  activo: fila.activo,
  orden: fila.orden,
});

@Injectable()
export class CatalogosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Lectura ───────────────────────────

  /**
   * Las ZONAS DE LA CIUDAD, para las pantallas que no son de un formulario: la ficha de personal,
   * la cobertura, la flota y el mantenimiento (`GET /zonales`). Por omisión solo las vigentes.
   *
   * Para registrar un operativo NO se usa esta, sino `zonalesDeFormulario`.
   */
  async listarZonales(incluirInactivas = false): Promise<Zonal[]> {
    return this.prisma.zonal.findMany({
      where: incluirInactivas ? undefined : { activo: true },
      orderBy: { orden: 'asc' },
    });
  }

  // ───────────────── Zonales DE UN FORMULARIO (2026-10-13) ─────────────────

  /** Las zonales del formulario PARA ADMINISTRAR, con las desactivadas, en el orden de la ciudad. */
  async zonalesDelFormulario(
    formularioId: number,
  ): Promise<ZonalDeFormulario[]> {
    return this.prisma.zonalFormulario.findMany({
      where: { formularioId },
      include: { zona: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
  }

  async buscarZonalDeFormulario(
    formularioId: number,
    zonaId: number,
  ): Promise<ZonalDeFormulario | null> {
    return this.prisma.zonalFormulario.findUnique({
      where: { formularioId_zonaId: { formularioId, zonaId } },
      include: { zona: true },
    });
  }

  async buscarZona(zonaId: number): Promise<Zonal | null> {
    return this.prisma.zonal.findUnique({ where: { id: zonaId } });
  }

  /** Las zonas de la ciudad vigentes que el formulario TODAVÍA no tiene: lo que ofrece el alta. */
  async zonasDisponibles(formularioId: number): Promise<Zonal[]> {
    return this.prisma.zonal.findMany({
      where: { activo: true, formularios: { none: { formularioId } } },
      orderBy: { orden: 'asc' },
    });
  }

  /** Para comprobar el nombre duplicado DENTRO del formulario, con la normalización aparte. */
  async nombresDeZonalesDeFormulario(
    formularioId: number,
  ): Promise<{ id: number; zonaId: number; nombre: string }[]> {
    return this.prisma.zonalFormulario.findMany({
      where: { formularioId },
      select: { id: true, zonaId: true, nombre: true },
    });
  }

  async crearZonalDeFormulario(
    datos: {
      formularioId: number;
      zonaId: number;
      nombre: string;
      orden: number;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<ZonalFormulario> {
    return cliente.zonalFormulario.create({ data: datos });
  }

  async actualizarZonalDeFormulario(
    id: number,
    datos: { nombre?: string; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<ZonalFormulario> {
    return cliente.zonalFormulario.update({ where: { id }, data: datos });
  }

  /** Borra SOLO la zonal del formulario. La zona de la ciudad no se borra desde aquí, nunca. */
  async eliminarZonalDeFormulario(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.zonalFormulario.delete({ where: { id } });
  }

  /** Operativos DE ESE FORMULARIO que llevan la zona: lo que decide si su zonal se puede borrar. */
  async contarOperativosDeFormularioConZona(
    formularioId: number,
    zonaId: number,
  ): Promise<number> {
    return this.prisma.operativoZonal.count({
      where: { zonalId: zonaId, operativo: { formularioId } },
    });
  }

  /** Por zona, cuántos operativos del formulario la llevan. Una consulta para toda la lista. */
  async operativosPorZonaDeFormulario(
    formularioId: number,
  ): Promise<Map<number, number>> {
    const filas = await this.prisma.operativoZonal.groupBy({
      by: ['zonalId'],
      where: { operativo: { formularioId } },
      _count: { _all: true },
    });
    return new Map(filas.map((fila) => [fila.zonalId, fila._count._all]));
  }

  /** Por zona, los puntos del formulario (todos) y los vigentes. Dos agrupaciones, ninguna por fila. */
  async puntosPorZonaDeFormulario(
    formularioId: number,
  ): Promise<{ todos: Map<number, number>; activos: Map<number, number> }> {
    const [todos, activos] = await Promise.all([
      this.prisma.puntoEncuentro.groupBy({
        by: ['zonalId'],
        where: { formularioId },
        _count: { _all: true },
      }),
      this.prisma.puntoEncuentro.groupBy({
        by: ['zonalId'],
        where: { formularioId, activo: true },
        _count: { _all: true },
      }),
    ]);
    const mapa = (filas: { zonalId: number; _count: { _all: number } }[]) =>
      new Map(filas.map((fila) => [fila.zonalId, fila._count._all]));
    return { todos: mapa(todos), activos: mapa(activos) };
  }

  /**
   * Los puntos VIGENTES de la zonal EN ESE FORMULARIO: lo que se desactiva en cascada al dar de
   * baja la zonal del formulario. Los de otros formularios en la misma zona no se tocan.
   */
  async puntosActivosDeZonalDeFormulario(
    formularioId: number,
    zonaId: number,
  ): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.puntoEncuentro.findMany({
      where: { formularioId, zonalId: zonaId, activo: true },
      select: { id: true, nombre: true },
    });
  }

  // ─────────── Borrado FÍSICO (baja definitiva). Solo lo llama el servicio tras comprobar
  // que el valor no se usó en ningún operativo (las FK hacia el catálogo son RESTRICT). ───────────

  async eliminarPunto(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.puntoEncuentro.delete({ where: { id } });
  }

  async eliminarTipoControl(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.tipoControl.delete({ where: { id } });
  }

  async eliminarInstitucion(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.institucion.delete({ where: { id } });
  }

  /**
   * Las zonales que ese formulario ofrece AL REGISTRAR: las suyas vigentes —con su zona de la
   * ciudad vigente— que tienen al menos un punto de encuentro vigente. El punto es obligatorio al
   * registrar, así que una zonal sin puntos es un callejón sin salida y no se ofrece (RN-18).
   */
  async zonalesDeFormulario(formularioId: number): Promise<Zonal[]> {
    const filas = await this.prisma.zonalFormulario.findMany({
      where: {
        formularioId,
        activo: true,
        zona: { activo: true },
        puntos: { some: { activo: true } },
      },
      include: { zona: true },
      orderBy: [{ orden: 'asc' }, { nombre: 'asc' }],
    });
    return filas.map(comoZonal);
  }

  async catalogosDeFormulario(
    formularioId: number,
  ): Promise<CatalogosDelimitados> {
    const [puntos, tipos, instituciones] = await Promise.all([
      this.prisma.puntoEncuentro.findMany({
        where: { activo: true, formularioId },
        include: { zonal: true, zonalFormulario: true },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.tipoControl.findMany({
        where: { activo: true, formularioId },
        orderBy: { nombre: 'asc' },
      }),
      this.prisma.institucion.findMany({
        where: { activo: true, formularioId },
        orderBy: { sigla: 'asc' },
      }),
    ]);

    return { puntos, tiposControl: tipos, instituciones };
  }

  /**
   * Igual que `catalogosDeFormulario` PERO INCLUYE LOS DESACTIVADOS, para la
   * administración. Es lo que cierra PV-36: el camino operativo filtra `activo: true`
   * —lo comparte con el registro de operativos y no puede ver lo retirado—, así que
   * reactivar exigía un camino propio que sí lo viera.
   */
  async catalogosDeFormularioConInactivos(
    formularioId: number,
  ): Promise<CatalogosAdmin> {
    const [puntos, tipos, instituciones] = await Promise.all([
      this.prisma.puntoEncuentro.findMany({
        where: { formularioId },
        include: {
          zonal: true,
          zonalFormulario: true,
          _count: { select: { operativos: true } },
        },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.tipoControl.findMany({
        where: { formularioId },
        include: {
          _count: { select: { operativos: true, operativosMultiples: true } },
        },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.institucion.findMany({
        where: { formularioId },
        include: { _count: { select: { operativos: true } } },
        orderBy: [{ activo: 'desc' }, { sigla: 'asc' }],
      }),
    ]);

    return { puntos, tiposControl: tipos, instituciones };
  }

  /** RN-17. El punto depende de la zonal, dentro de los del formulario. */
  async puntosDeFormularioYZonal(
    formularioId: number,
    zonalId: number,
  ): Promise<PuntoEncuentro[]> {
    return this.prisma.puntoEncuentro.findMany({
      where: { activo: true, zonalId, formularioId },
      orderBy: { nombre: 'asc' },
    });
  }

  // ───────────────── Denominaciones, para evitar duplicados ─────────────────

  /** Los nombres de puntos del formulario en una zonal: la unicidad es por (formulario, zonal). */
  async nombresDePuntosDeFormularioYZonal(
    formularioId: number,
    zonalId: number,
  ): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.puntoEncuentro.findMany({
      where: { formularioId, zonalId },
      select: { id: true, nombre: true },
    });
  }

  async nombresDeTiposControlDeFormulario(
    formularioId: number,
  ): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.tipoControl.findMany({
      where: { formularioId },
      select: { id: true, nombre: true },
    });
  }

  /**
   * Siglas y denominaciones de las instituciones del formulario: las dos son únicas dentro de él
   * (la denominación desde el 2026-10-12), comparadas sin tildes ni mayúsculas.
   */
  async siglasDeInstitucionesDeFormulario(
    formularioId: number,
  ): Promise<{ id: number; sigla: string; nombre: string }[]> {
    return this.prisma.institucion.findMany({
      where: { formularioId },
      select: { id: true, sigla: true, nombre: true },
    });
  }

  // ─────────────────────────── Escritura ───────────────────────────

  async crearPunto(
    datos: { nombre: string; zonalId: number; formularioId: number },
    cliente: Prisma.TransactionClient,
  ): Promise<PuntoEncuentro> {
    return cliente.puntoEncuentro.create({ data: datos });
  }

  async actualizarPunto(
    id: number,
    datos: { nombre?: string; zonalId?: number; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<PuntoEncuentro> {
    return cliente.puntoEncuentro.update({ where: { id }, data: datos });
  }

  async buscarPunto(id: number): Promise<PuntoEncuentro | null> {
    return this.prisma.puntoEncuentro.findUnique({ where: { id } });
  }

  async crearTipoControl(
    nombre: string,
    formularioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<TipoControl> {
    return cliente.tipoControl.create({ data: { nombre, formularioId } });
  }

  async actualizarTipoControl(
    id: number,
    datos: { nombre?: string; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<TipoControl> {
    return cliente.tipoControl.update({ where: { id }, data: datos });
  }

  async buscarTipoControl(id: number): Promise<TipoControl | null> {
    return this.prisma.tipoControl.findUnique({ where: { id } });
  }

  async crearInstitucion(
    datos: { sigla: string; nombre: string; formularioId: number },
    cliente: Prisma.TransactionClient,
  ): Promise<Institucion> {
    return cliente.institucion.create({ data: datos });
  }

  async actualizarInstitucion(
    id: number,
    datos: { sigla?: string; nombre?: string; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<Institucion> {
    return cliente.institucion.update({ where: { id }, data: datos });
  }

  async buscarInstitucion(id: number): Promise<Institucion | null> {
    return this.prisma.institucion.findUnique({ where: { id } });
  }

  // ─────────────────────── Uso en cuadros históricos ───────────────────────

  /** RF-058. Cuántos operativos registran este punto de encuentro. */
  async contarOperativosConPunto(puntoId: number): Promise<number> {
    return this.prisma.operativo.count({
      where: { puntoEncuentroId: puntoId },
    });
  }

  /**
   * Un operativo lleva el tipo por su columna única (`tico_id`) O por la tabla de varios tipos
   * (`t_operativo_tipo_control`), que es la que se llena desde que los nueve formularios admiten
   * varios (2026-09-14). Contar solo la columna decía «0 operativos» de tipos usados, y el borrado
   * llegaba a la FK de la base en vez de al 409 con su motivo (defecto corregido el 2026-10-12).
   */
  async contarOperativosConTipoControl(tipoId: number): Promise<number> {
    return this.prisma.operativo.count({
      where: {
        OR: [{ tipoControlId: tipoId }, { tiposControl: { some: { tipoId } } }],
      },
    });
  }

  async contarOperativosConInstitucion(institucionId: number): Promise<number> {
    return this.prisma.operativoInstitucion.count({ where: { institucionId } });
  }
}
