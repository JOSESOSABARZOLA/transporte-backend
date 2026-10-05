/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Auditoría
 * Archivo: auditoria.repository.ts
 * Responsabilidad: Escribir la traza de auditoría en la base.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Único punto de este ámbito que toca la persistencia.
 */

import { Injectable } from '@nestjs/common';
import type { AccionAuditoria, Prisma, RolDepartamental } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** Cliente de Prisma dentro de una transacción, o el cliente normal. */
export type ClientePrisma = Prisma.TransactionClient | PrismaService;

export interface RegistroAuditoria {
  entidad: string;
  entidadId: number;
  accion: AccionAuditoria;
  usuario: number;
  rol: RolDepartamental;
  operativoId?: number;
  campo?: string;
  valorAnterior?: string;
  valorNuevo?: string;
  correlacion?: string;
}

@Injectable()
export class AuditoriaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserta una traza. Recibe el cliente para poder escribir DENTRO de la
   * transacción de la operación auditada.
   */
  async insertar(
    registro: RegistroAuditoria,
    cliente: ClientePrisma = this.prisma,
  ): Promise<void> {
    await cliente.auditoria.create({ data: registro });
  }

  /** Inserta varias trazas en una sola operación. */
  async insertarVarias(
    registros: RegistroAuditoria[],
    cliente: ClientePrisma = this.prisma,
  ): Promise<void> {
    if (registros.length === 0) return;
    await cliente.auditoria.createMany({ data: registros });
  }
}
