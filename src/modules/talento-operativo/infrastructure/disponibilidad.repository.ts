/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Disponibilidad del personal
 * Archivo: disponibilidad.repository.ts
 * Responsabilidad: Leer y escribir los períodos de ausencia.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * `t_disponibilidad` sirve a tres sujetos excluyentes —funcionario, conductor y
 * vehículo—, y `ck_disponibilidad_sujeto` obliga a que esté informado exactamente uno.
 * Este repositorio solo escribe filas de FUNCIONARIO: las de conductor y vehículo son
 * de M-18, y mezclarlas aquí obligaría a razonar sobre cuál de los tres campos viene
 * en cada llamada.
 */

import { Injectable } from '@nestjs/common';
import type {
  Disponibilidad,
  EstadoDisponibilidad,
  Prisma,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

export interface NuevaAusencia {
  funcionarioId: number;
  estado: EstadoDisponibilidad;
  desde: Date;
  hasta: Date;
  motivo: string | null;
  registradoPor: number;
}

@Injectable()
export class DisponibilidadRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Períodos de una persona, del más reciente al más antiguo. */
  async listarDeFuncionario(funcionarioId: number): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: { funcionarioId },
      orderBy: { desde: 'desc' },
    });
  }

  /**
   * Períodos de una persona que se cruzan con el rango indicado.
   *
   * Los extremos son inclusivos, igual que en `ck_disponibilidad_rango`: una ausencia
   * del 1 al 15 comprende ambos días.
   */
  async listarSolapados(
    funcionarioId: number,
    desde: Date,
    hasta: Date,
  ): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: {
        funcionarioId,
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
    });
  }

  /**
   * Personas con alguna ausencia excluyente dentro del rango.
   *
   * Devuelve identificadores y no filas completas: quien pregunta solo necesita saber
   * a quién descartar, y traer el motivo de la ausencia de cada persona sería exponer
   * un dato de salud —«reposo médico»— a quien arma el cuadro.
   */
  async funcionariosAusentesEntre(
    desde: Date,
    hasta: Date,
    estados: EstadoDisponibilidad[],
  ): Promise<Set<number>> {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        funcionarioId: { not: null },
        estado: { in: estados },
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
      select: { funcionarioId: true },
      distinct: ['funcionarioId'],
    });

    return new Set(
      filas
        .map((fila) => fila.funcionarioId)
        .filter((id): id is number => id !== null),
    );
  }

  async buscarPorId(id: number): Promise<Disponibilidad | null> {
    return this.prisma.disponibilidad.findUnique({ where: { id } });
  }

  async crear(
    datos: NuevaAusencia,
    cliente: Prisma.TransactionClient,
  ): Promise<Disponibilidad> {
    return cliente.disponibilidad.create({ data: datos });
  }

  async eliminar(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<Disponibilidad> {
    return cliente.disponibilidad.delete({ where: { id } });
  }
}
