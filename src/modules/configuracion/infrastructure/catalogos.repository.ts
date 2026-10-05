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
 * CADA CATÁLOGO PERTENECE A UN FORMULARIO (2026-09-29): puntos, tipos de control e
 * instituciones llevan su `formularioId` propio, de modo que un formulario despliega
 * exactamente los suyos (RN-16) sin tablas puente. Solo la ZONAL sigue siendo global —es una
 * zona geográfica de la ciudad, referenciada por el personal y la flota—; un formulario "usa"
 * las zonales donde tiene algún punto, derivado de sus puntos.
 */

import { Injectable } from '@nestjs/common';
import type {
  Institucion,
  Prisma,
  PuntoEncuentro,
  TipoControl,
  Zonal,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Punto de encuentro con su zonal. Pertenece a UN formulario por su `formularioId`. */
export type PuntoConZonal = Prisma.PuntoEncuentroGetPayload<{
  include: { zonal: true };
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

@Injectable()
export class CatalogosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Lectura ───────────────────────────

  /**
   * Las zonales, para ADMINISTRACION: P-08 la necesita entera para poder dar de alta el
   * primer punto de una zonal que todavia no tiene ninguno, que es la razon de ser de esa
   * pantalla. Por omision solo las vigentes; con `incluirInactivas` tambien las
   * desactivadas, que es lo que esa pantalla pide para reactivarlas.
   *
   * Para registrar un operativo NO se usa esta, sino `zonalesDeFormulario`.
   */
  async listarZonales(incluirInactivas = false): Promise<Zonal[]> {
    return this.prisma.zonal.findMany({
      where: incluirInactivas ? undefined : { activo: true },
      orderBy: { orden: 'asc' },
    });
  }

  async crearZonal(
    datos: { codigo: string; nombre: string; orden: number; esDmq: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<Zonal> {
    return cliente.zonal.create({ data: datos });
  }

  async actualizarZonal(
    id: number,
    datos: { nombre?: string; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<Zonal> {
    return cliente.zonal.update({ where: { id }, data: datos });
  }

  /** Para comprobar el nombre duplicado, con acentos y mayúsculas normalizados aparte. */
  async nombresDeZonales(): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.zonal.findMany({ select: { id: true, nombre: true } });
  }

  /** Para garantizar el código único que se autogenera del nombre. */
  async codigosDeZonales(): Promise<string[]> {
    const filas = await this.prisma.zonal.findMany({
      select: { codigo: true },
    });
    return filas.map((fila) => fila.codigo);
  }

  /** El orden de una zonal nueva es el siguiente al mayor: se agrega al final de la lista. */
  async maxOrdenZonal(): Promise<number> {
    const fila = await this.prisma.zonal.aggregate({ _max: { orden: true } });
    return fila._max.orden ?? 0;
  }

  async contarOperativosConZonal(zonalId: number): Promise<number> {
    return this.prisma.operativoZonal.count({ where: { zonalId } });
  }

  /** Cuántos puntos (activos o no) cuelgan de una zonal: bloquean su borrado físico. */
  async contarPuntosDeZonal(zonalId: number): Promise<number> {
    return this.prisma.puntoEncuentro.count({ where: { zonalId } });
  }

  // ─────────── Borrado FÍSICO (baja definitiva). Solo lo llama el servicio tras comprobar
  // que el valor no se usó en ningún operativo (las FK hacia el catálogo son RESTRICT). ───────────

  async eliminarZonal(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.zonal.delete({ where: { id } });
  }

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
   * Los puntos VIGENTES de una zonal, sin distinguir formulario. Es lo que se desactiva en
   * cascada al dar de baja la zonal: un punto pertenece a la zonal por `zonalId`, y la zonal
   * es global, así que su baja arrastra los puntos de todos los formularios que cuelgan de ella.
   */
  async puntosActivosDeZonal(
    zonalId: number,
  ): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.puntoEncuentro.findMany({
      where: { zonalId, activo: true },
      select: { id: true, nombre: true },
    });
  }

  /**
   * Las zonales que ese formulario ofrece de verdad: aquellas donde tiene al menos un
   * punto de encuentro vigente. Se deriva de los PUNTOS del formulario (por su `formularioId`
   * directo): se agrega un punto en una zonal y la zonal aparece; se retira el último y
   * desaparece. El punto de encuentro es obligatorio al registrar, así que una zonal sin
   * puntos es un callejón sin salida y no se ofrece.
   */
  async zonalesDeFormulario(formularioId: number): Promise<Zonal[]> {
    return this.prisma.zonal.findMany({
      where: {
        activo: true,
        puntos: { some: { activo: true, formularioId } },
      },
      orderBy: { orden: 'asc' },
    });
  }

  async buscarZonal(zonalId: number): Promise<Zonal | null> {
    return this.prisma.zonal.findUnique({ where: { id: zonalId } });
  }

  async catalogosDeFormulario(
    formularioId: number,
  ): Promise<CatalogosDelimitados> {
    const [puntos, tipos, instituciones] = await Promise.all([
      this.prisma.puntoEncuentro.findMany({
        where: { activo: true, formularioId },
        include: { zonal: true },
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
  ): Promise<CatalogosDelimitados> {
    const [puntos, tipos, instituciones] = await Promise.all([
      this.prisma.puntoEncuentro.findMany({
        where: { formularioId },
        include: { zonal: true },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.tipoControl.findMany({
        where: { formularioId },
        orderBy: [{ activo: 'desc' }, { nombre: 'asc' }],
      }),
      this.prisma.institucion.findMany({
        where: { formularioId },
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

  /** Las siglas de instituciones del formulario: la unicidad de la sigla es por formulario. */
  async siglasDeInstitucionesDeFormulario(
    formularioId: number,
  ): Promise<{ id: number; sigla: string }[]> {
    return this.prisma.institucion.findMany({
      where: { formularioId },
      select: { id: true, sigla: true },
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

  async contarOperativosConTipoControl(tipoId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { tipoControlId: tipoId } });
  }

  async contarOperativosConInstitucion(institucionId: number): Promise<number> {
    return this.prisma.operativoInstitucion.count({ where: { institucionId } });
  }
}
