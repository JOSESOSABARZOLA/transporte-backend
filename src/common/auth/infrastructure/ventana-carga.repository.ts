/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: ventana-carga.repository.ts
 * Responsabilidad: Consultar la ventana de carga configurada para un rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { Injectable } from '@nestjs/common';
import type { RolDepartamental, VentanaCarga } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class VentanaCargaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la ventana del rol, o null si no tiene una configurada. */
  async buscarPorRol(rol: RolDepartamental): Promise<VentanaCarga | null> {
    return this.prisma.ventanaCarga.findUnique({ where: { rol } });
  }

  /**
   * Todas las ventanas. El horario de una (la DAF) se redacta con el cierre de las de registro
   * (RN-56), así que la guarda las necesita juntas para componer su mensaje (2026-10-06).
   */
  async listar(): Promise<VentanaCarga[]> {
    return this.prisma.ventanaCarga.findMany();
  }
}
