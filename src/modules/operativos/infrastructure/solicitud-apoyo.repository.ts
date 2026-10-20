/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitud-apoyo.repository.ts
 * Responsabilidad: Leer y escribir las solicitudes de apoyo entre direcciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * LA CONSULTA TRAE EL OPERATIVO Y SU FORMULARIO. La bandeja de la dirección requerida
 * tiene que decir **para qué** se le pide personal: sin el identificador, el horario y el
 * nombre del formulario, la solicitud es un número de rol y una cantidad, y nadie puede
 * decidir a quién manda con eso.
 *
 * `idx_solicitud_requerido` sobre (rol requerido, estado) es justamente el índice de esa
 * bandeja, y ya existía en el modelo aprobado.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoSolicitud,
  type AreaPersonal,
  type Prisma,
  type RolDepartamental,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Solicitud con el contexto mínimo del operativo al que pertenece. */
export type SolicitudConOperativo = Prisma.SolicitudApoyoGetPayload<{
  include: {
    operativo: {
      include: { formulario: true; cuadro: true };
    };
  };
}>;

const RELACIONES = {
  operativo: { include: { formulario: true, cuadro: true } },
} satisfies Prisma.SolicitudApoyoInclude;

/** Lo que el servicio ya validó y el repositorio se limita a escribir. */
export interface DatosSolicitud {
  operativoId: number;
  rolSolicitante: RolDepartamental;
  rolRequerido: RolDepartamental;
  areaRequerida: AreaPersonal | null;
  cantidad: number;
  observacion: string | null;
}

/** Criterios de la bandeja. */
export interface FiltroSolicitudes {
  /** Fecha de la jornada del operativo. */
  fecha?: Date;
  estado?: EstadoSolicitud;
  /** Rol que consulta. `null` para quienes ven todas: Dirección y administración. */
  rol: RolDepartamental | null;
}

@Injectable()
export class SolicitudApoyoRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listarDeOperativo(
    operativoId: number,
  ): Promise<SolicitudConOperativo[]> {
    return this.prisma.solicitudApoyo.findMany({
      where: { operativoId },
      include: RELACIONES,
      orderBy: { id: 'asc' },
    });
  }

  /**
   * Bandeja de un rol: lo que pidió y lo que le piden.
   *
   * Las dos direcciones en la misma consulta, porque son la misma pregunta desde los dos
   * lados: «¿qué apoyo hay abierto que me involucre?». Separarlas obligaría a la pantalla
   * a hacer dos llamadas para dibujar una sola lista.
   */
  async listar(filtro: FiltroSolicitudes): Promise<SolicitudConOperativo[]> {
    const where: Prisma.SolicitudApoyoWhereInput = {};

    if (filtro.estado) where.estado = filtro.estado;
    if (filtro.fecha) where.operativo = { cuadro: { fecha: filtro.fecha } };

    if (filtro.rol) {
      where.OR = [{ rolRequerido: filtro.rol }, { rolSolicitante: filtro.rol }];
    }

    return this.prisma.solicitudApoyo.findMany({
      where,
      include: RELACIONES,
      orderBy: [{ estado: 'asc' }, { id: 'desc' }],
    });
  }

  /**
   * Una solicitud idéntica que siga abierta.
   *
   * No es una regla de negocio: es la defensa contra el doble envío. El modelo admite
   * varias solicitudes por operativo —a direcciones distintas, o de áreas distintas— y
   * por eso no hay restricción única que lo resuelva en la base.
   */
  async buscarEquivalenteAbierta(
    datos: DatosSolicitud,
  ): Promise<SolicitudConOperativo | null> {
    return this.prisma.solicitudApoyo.findFirst({
      where: {
        operativoId: datos.operativoId,
        rolRequerido: datos.rolRequerido,
        areaRequerida: datos.areaRequerida,
        estado: EstadoSolicitud.SOLICITADA,
      },
      include: RELACIONES,
    });
  }

  /** El operativo activo y quién lo registró (para «Pedir priorización» de la DAF, Fase 3). */
  async operativoParaPriorizar(id: number): Promise<{
    id: number;
    identificador: string;
    creadoPorRol: RolDepartamental;
  } | null> {
    return this.prisma.operativo.findFirst({
      where: { id, activo: true },
      select: { id: true, identificador: true, creadoPorRol: true },
    });
  }

  /** La solicitud ABIERTA de un operativo pedida por un rol (la priorización es una sola). */
  async buscarAbiertaDe(
    operativoId: number,
    rolSolicitante: RolDepartamental,
  ): Promise<SolicitudConOperativo | null> {
    return this.prisma.solicitudApoyo.findFirst({
      where: {
        operativoId,
        rolSolicitante,
        estado: EstadoSolicitud.SOLICITADA,
      },
      include: RELACIONES,
    });
  }

  async crear(
    datos: DatosSolicitud,
    cliente: Prisma.TransactionClient,
  ): Promise<SolicitudConOperativo> {
    return cliente.solicitudApoyo.create({
      data: datos,
      include: RELACIONES,
    });
  }
}
