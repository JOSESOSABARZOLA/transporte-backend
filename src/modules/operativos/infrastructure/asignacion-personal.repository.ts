/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: asignacion-personal.repository.ts
 * Responsabilidad: Leer y escribir el personal asignado a un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * LEE `t_funcionario` A TRAVÉS DE LA RELACIÓN, no como maestro. La ficha del personal
 * —altas, bajas, disponibilidad, elegibilidad— es de `talento-operativo` y se consulta
 * por servicio publicado. Aquí solo se acompaña la asignación con el nombre, el área y
 * el teléfono que la fila del cuadro tiene que mostrar (RN-34).
 *
 * EL TELÉFONO SALE DE AQUÍ Y NUNCA DE LA PETICIÓN. Es literalmente RN-34: «el teléfono
 * está asociado a la persona en el maestro y no se digita en el formulario». Si viajara
 * en el cuerpo, el cuadro acabaría con tres números distintos para la misma persona.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma, RolDepartamental } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Asignación con los datos de la persona que la fila del cuadro muestra. */
export type AsignacionConFuncionario = Prisma.AsignacionPersonalGetPayload<{
  include: { funcionario: true };
}>;

@Injectable()
export class AsignacionPersonalRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** El personal del operativo, con el responsable primero. */
  async listarDeOperativo(
    operativoId: number,
  ): Promise<AsignacionConFuncionario[]> {
    return this.prisma.asignacionPersonal.findMany({
      where: { operativoId },
      include: { funcionario: true },
      orderBy: [{ esResponsable: 'desc' }, { id: 'asc' }],
    });
  }

  async buscar(
    operativoId: number,
    funcionarioId: number,
  ): Promise<AsignacionConFuncionario | null> {
    return this.prisma.asignacionPersonal.findUnique({
      where: { operativoId_funcionarioId: { operativoId, funcionarioId } },
      include: { funcionario: true },
    });
  }

  async crear(
    datos: {
      operativoId: number;
      funcionarioId: number;
      asignadoPorRol: RolDepartamental;
      esResponsable: boolean;
      /** Ventana horaria PROPIA de la persona. NULL: cumple el horario del operativo. */
      horaInicio?: string | null;
      horaFin?: string | null;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<AsignacionConFuncionario> {
    return cliente.asignacionPersonal.create({
      data: {
        operativoId: datos.operativoId,
        funcionarioId: datos.funcionarioId,
        asignadoPorRol: datos.asignadoPorRol,
        esResponsable: datos.esResponsable,
        horaInicio: datos.horaInicio ?? null,
        horaFin: datos.horaFin ?? null,
      },
      include: { funcionario: true },
    });
  }

  /**
   * Quita el responsable a las demás asignaciones del operativo.
   *
   * El modelo no tiene restricción de responsable único —`aper_es_responsable` es un
   * booleano por fila—, así que la exclusividad se sostiene aquí: sin esto, dos
   * responsables aparecerían en la misma fila del cuadro y la orden de servicio no
   * sabría a quién nombrar.
   */
  async retirarResponsabilidad(
    operativoId: number,
    exceptoFuncionarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.asignacionPersonal.updateMany({
      where: {
        operativoId,
        funcionarioId: { not: exceptoFuncionarioId },
        esResponsable: true,
      },
      data: { esResponsable: false },
    });
  }

  /**
   * Cambia el turno propio de una asignación existente (RN-66, 2026-09-09).
   *
   * Las dos horas viajan juntas y completas: editar el horario es fijar una ventana, no
   * dejarla a medias. La clave compuesta identifica la fila; si no existiera, Prisma lanza,
   * y el servicio ya comprobó antes que la persona figura en el operativo.
   */
  async actualizarTurno(
    operativoId: number,
    funcionarioId: number,
    horaInicio: string,
    horaFin: string,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.asignacionPersonal.update({
      where: { operativoId_funcionarioId: { operativoId, funcionarioId } },
      data: { horaInicio, horaFin },
    });
  }

  /** Devuelve `false` si la asignación ya no existía. */
  async eliminar(
    operativoId: number,
    funcionarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<boolean> {
    const eliminadas = await cliente.asignacionPersonal.deleteMany({
      where: { operativoId, funcionarioId },
    });

    return eliminadas.count > 0;
  }
}
