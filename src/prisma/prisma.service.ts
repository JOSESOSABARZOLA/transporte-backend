/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Acceso a datos
 * Archivo: prisma.service.ts
 * Responsabilidad: Gobernar el ciclo de vida de la conexión de Prisma con PostgreSQL.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-04
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { appConfig } from '../config/app.config';

/**
 * Cliente de Prisma con el ciclo de vida atado al de la aplicación: conecta al
 * iniciar el módulo y desconecta de forma ordenada al terminar.
 *
 * Regla de uso: **solo la capa `infrastructure` de cada submódulo toca este servicio**.
 * Los controladores y los servicios de aplicación nunca lo inyectan.
 * Ver docs/IMPLEMENTATION_GUIDE.md §13.3.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // El registro de consultas se activa en desarrollo y se desactiva en producción.
    // Ver docs/FASE4-arquitectura-tecnica.md §7.1.
    super({
      log: appConfig.baseDatos.registroConsultas
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Conexión establecida con la base transportedb.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Conexión con la base cerrada de forma ordenada.');
  }
}
