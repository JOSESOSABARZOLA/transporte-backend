/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.repository.ts
 * Responsabilidad: Leer y escribir las ausencias de los conductores en `t_disponibilidad`.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * Único punto que toca Prisma para las ausencias de conductor (plan
 * «ausencias-conductores-flota»). Todas las consultas filtran por `cond_id` y excluyen
 * `DISPONIBLE` y `MANTENIMIENTO`: lo primero no es una ausencia y lo segundo es de vehículos.
 * Los LECTORES de la planificación (`FlotaRepository.conductoresAusentes`,
 * `PlanificacionTransporteRepository.ausenciasConductoresEnRango`) no se tocan: ya leen estas
 * mismas filas.
 */

import { Injectable } from '@nestjs/common';
import type {
  Disponibilidad,
  EstadoDisponibilidad,
  Prisma,
} from '@prisma/client';

import { ESTADOS_QUE_EXCLUYEN } from '../../../common/ausencias/reglas-ausencia';
import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

export interface NuevaAusenciaConductor {
  conductorId: number;
  estado: EstadoDisponibilidad;
  desde: Date;
  hasta: Date;
  motivo: string | null;
  registradoPor: number;
}

/** Una ausencia en la lista de la flota. Sin el motivo: puede ser un dato de salud. */
export interface AusenciaDeLaFlota {
  id: number;
  conductorId: number;
  estado: EstadoDisponibilidad;
  desde: Date;
  hasta: Date;
}

/** Un tramo ya asignado al conductor dentro del rango de la ausencia (aviso A5). */
export interface TramoDelConductor {
  operativoId: number;
  identificador: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
}

/** Solo los estados que son ausencia de una persona (RN-30). */
const SOLO_AUSENCIAS = { in: ESTADOS_QUE_EXCLUYEN } as const;

@Injectable()
export class AusenciasConductorRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async existeConductor(
    id: number,
  ): Promise<{ nombreCompleto: string } | null> {
    return this.prisma.conductor.findUnique({
      where: { id },
      select: { nombreCompleto: true },
    });
  }

  /** Las ausencias de un conductor, de la más reciente hacia atrás. */
  async listarDe(conductorId: number): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: { conductorId, estado: SOLO_AUSENCIAS },
      orderBy: { desde: 'desc' },
    });
  }

  /**
   * En curso y próximas de TODA la flota desde `desde`, en una sola consulta: la tabla de
   * conductores pinta «Ausente dd/mm–dd/mm» sin pedir una por fila (sin N+1).
   */
  async vigentesYProximas(desde: Date): Promise<AusenciaDeLaFlota[]> {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        conductorId: { not: null },
        estado: SOLO_AUSENCIAS,
        hasta: { gte: desde },
      },
      select: {
        id: true,
        conductorId: true,
        estado: true,
        desde: true,
        hasta: true,
      },
      orderBy: [{ conductorId: 'asc' }, { desde: 'asc' }],
    });

    return filas.flatMap((fila) =>
      fila.conductorId === null
        ? []
        : [{ ...fila, conductorId: fila.conductorId }],
    );
  }

  /**
   * INV-14 aplicado al conductor: sus ausencias que se cruzan con el rango. La comparación la
   * hace la base (extremos inclusivos), igual que `mantenimientosQueSolapan`.
   */
  async solapadas(
    conductorId: number,
    desde: Date,
    hasta: Date,
  ): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: {
        conductorId,
        estado: SOLO_AUSENCIAS,
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
      orderBy: { desde: 'asc' },
    });
  }

  async buscar(id: number): Promise<Disponibilidad | null> {
    return this.prisma.disponibilidad.findFirst({
      where: { id, conductorId: { not: null }, estado: SOLO_AUSENCIAS },
    });
  }

  async crear(
    datos: NuevaAusenciaConductor,
    cliente: Prisma.TransactionClient,
  ): Promise<Disponibilidad> {
    return cliente.disponibilidad.create({ data: datos });
  }

  async eliminar(id: number, cliente: Prisma.TransactionClient): Promise<void> {
    await cliente.disponibilidad.delete({ where: { id } });
  }

  /**
   * Los tramos de operativos ACTIVOS ya asignados al conductor dentro del rango (A5). Las
   * tareas de taller no cuentan: no son un operativo que quedaría sin conductor.
   */
  async tramosEnRango(
    conductorId: number,
    desde: Date,
    hasta: Date,
  ): Promise<TramoDelConductor[]> {
    const tramos = await this.prisma.tramoTransporte.findMany({
      where: {
        conductorId,
        fecha: { gte: desde, lte: hasta },
        operativoId: { not: null },
        operativo: { activo: true },
      },
      select: {
        operativoId: true,
        fecha: true,
        horaInicio: true,
        horaFin: true,
        operativo: { select: { identificador: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    return tramos.flatMap((tramo) =>
      tramo.operativoId === null || !tramo.operativo
        ? []
        : [
            {
              operativoId: tramo.operativoId,
              identificador: tramo.operativo.identificador,
              fecha: tramo.fecha,
              horaInicio: tramo.horaInicio,
              horaFin: tramo.horaFin,
            },
          ],
    );
  }
}
