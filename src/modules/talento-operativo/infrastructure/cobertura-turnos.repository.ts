/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-turnos.repository.ts
 * Responsabilidad: Leer y escribir la cobertura mensual por turnos del personal de Instrucción.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * LAS AUSENCIAS NO SE ESCRIBEN AQUÍ. La cobertura solo guarda DIURNO/NOCTURNO/DESCANSO; las
 * vacaciones y reposos se leen de `t_disponibilidad`, su fuente única de verdad, y se
 * superponen en el servicio. Así un mismo día no tiene dos estados que se contradigan.
 */

import { Injectable } from '@nestjs/common';
import {
  AreaPersonal,
  EstadoCoberturaMes,
  EstadoDisponibilidad,
  type CoberturaMes,
  type CoberturaTurno,
  type DenominacionInstruccion,
  type Disponibilidad,
  type EstadoTurno,
  type Prisma,
  type RolDepartamental,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Funcionario de Instrucción con su zona, para agrupar la matriz. */
export type FuncionarioCobertura = Prisma.FuncionarioGetPayload<{
  include: { zonal: true };
}>;

@Injectable()
export class CoberturaTurnosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /**
   * El personal de INSTRUCCIÓN dentro del alcance de quien pregunta. Ordenado por zona,
   * denominación y apellidos, que es como se lee la matriz.
   */
  async personalDeInstruccion(
    direcciones: readonly RolDepartamental[],
  ): Promise<FuncionarioCobertura[]> {
    if (direcciones.length === 0) return [];

    return this.prisma.funcionario.findMany({
      where: {
        activo: true,
        area: AreaPersonal.INSTRUCCION,
        direccion: { in: [...direcciones] },
      },
      include: { zonal: true },
      orderBy: [
        { zonal: { orden: 'asc' } },
        { denominacion: 'asc' },
        { apellidos: 'asc' },
      ],
    });
  }

  /** Las celdas guardadas (DIURNO/NOCTURNO/DESCANSO) de esas personas en el rango del mes. */
  async coberturasEnRango(
    funcionarioIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<CoberturaTurno[]> {
    if (funcionarioIds.length === 0) return [];

    return this.prisma.coberturaTurno.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        fecha: { gte: desde, lte: hasta },
      },
    });
  }

  /** Las ausencias (todo lo que no es DISPONIBLE) que solapan el rango del mes. */
  async ausenciasEnRango(
    funcionarioIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<Disponibilidad[]> {
    if (funcionarioIds.length === 0) return [];

    return this.prisma.disponibilidad.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
    });
  }

  /** ¿Está esta persona dentro del alcance y es de Instrucción? Para validar la escritura. */
  async esDeInstruccion(
    funcionarioId: number,
    direcciones: readonly RolDepartamental[],
  ): Promise<boolean> {
    if (direcciones.length === 0) return false;

    const fila = await this.prisma.funcionario.findFirst({
      where: {
        id: funcionarioId,
        activo: true,
        area: AreaPersonal.INSTRUCCION,
        direccion: { in: [...direcciones] },
      },
      select: { id: true },
    });

    return fila !== null;
  }

  /** Fija la zona y/o denominación de Instrucción de una persona (para agruparla). */
  async actualizarZonaDenominacion(
    funcionarioId: number,
    zonalId: number | null | undefined,
    denominacion: DenominacionInstruccion | null | undefined,
  ): Promise<void> {
    await this.prisma.funcionario.update({
      where: { id: funcionarioId },
      // `undefined` no toca el campo; `null` lo limpia; un valor lo fija.
      data: { zonalId, denominacion },
    });
  }

  /**
   * De estos ids, los que son de Instrucción, activos y de una dirección al alcance. EN LOTE, para
   * validar un lote de celdas sin una consulta por persona.
   */
  async idsDeInstruccion(
    funcionarioIds: number[],
    direcciones: readonly RolDepartamental[],
  ): Promise<Set<number>> {
    if (funcionarioIds.length === 0 || direcciones.length === 0) {
      return new Set();
    }

    const filas = await this.prisma.funcionario.findMany({
      where: {
        id: { in: funcionarioIds },
        activo: true,
        area: AreaPersonal.INSTRUCCION,
        direccion: { in: [...direcciones] },
      },
      select: { id: true },
    });

    return new Set(filas.map((fila) => fila.id));
  }

  /** Fija (o cambia) el turno de una persona en un día. Uno por (funcionario, fecha). */
  async guardarCelda(
    funcionarioId: number,
    fecha: Date,
    estado: EstadoTurno,
    usuarioId: number,
    cliente?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = cliente ?? this.prisma;
    await db.coberturaTurno.upsert({
      where: {
        funcionarioId_fecha: { funcionarioId, fecha },
      },
      create: { funcionarioId, fecha, estado, registradoPor: usuarioId },
      update: { estado, registradoPor: usuarioId },
    });
  }

  /** Limpia la celda: el día queda vacío (sin turno), que es «sin restricción de horario». */
  async borrarCelda(
    funcionarioId: number,
    fecha: Date,
    cliente?: Prisma.TransactionClient,
  ): Promise<void> {
    const db = cliente ?? this.prisma;
    await db.coberturaTurno.deleteMany({ where: { funcionarioId, fecha } });
  }

  // ─────────────────────── Estado (informativo) del mes ───────────────────────

  /** El estado del mes para esa dirección, o `null` si no hay fila (= BORRADOR). */
  async estadoMes(
    mes: string,
    direccion: RolDepartamental,
  ): Promise<CoberturaMes | null> {
    return this.prisma.coberturaMes.findUnique({
      where: { mes_direccion: { mes, direccion } },
    });
  }

  /** Publica el mes (crea la fila si no existía). */
  async publicarMes(
    mes: string,
    direccion: RolDepartamental,
    usuarioId: number,
  ): Promise<CoberturaMes> {
    const ahora = new Date();
    return this.prisma.coberturaMes.upsert({
      where: { mes_direccion: { mes, direccion } },
      create: {
        mes,
        direccion,
        estado: EstadoCoberturaMes.PUBLICADO,
        publicadoPor: usuarioId,
        publicadoEn: ahora,
      },
      update: {
        estado: EstadoCoberturaMes.PUBLICADO,
        publicadoPor: usuarioId,
        publicadoEn: ahora,
      },
    });
  }

  /** Un mes PUBLICADO que se edita pasa a PUBLICADO_CON_CAMBIOS. Un borrador sigue igual. */
  async marcarConCambios(
    meses: readonly string[],
    direccion: RolDepartamental,
    cliente?: Prisma.TransactionClient,
  ): Promise<void> {
    if (meses.length === 0) return;
    const db = cliente ?? this.prisma;
    await db.coberturaMes.updateMany({
      where: {
        mes: { in: [...meses] },
        direccion,
        estado: EstadoCoberturaMes.PUBLICADO,
      },
      data: { estado: EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS },
    });
  }
}
