/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Acceso a datos
 * Archivo: prisma.module.ts
 * Responsabilidad: Publicar PrismaService de forma global a toda la aplicación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04
 */

import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Módulo global: evita tener que importarlo en cada submódulo.
 * Ver docs/IMPLEMENTATION_GUIDE.md §13.2.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
