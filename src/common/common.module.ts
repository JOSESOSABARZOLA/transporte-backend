/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transversal
 * Archivo: common.module.ts
 * Responsabilidad: Publicar el registro y la auditoría a toda la aplicación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { Global, Module } from '@nestjs/common';

import { AuditoriaRepository } from './auditoria/auditoria.repository';
import { AuditoriaService } from './auditoria/auditoria.service';
import { LoggerService } from './logger/logger.service';

/**
 * Global: el registro y la auditoría los necesitan todos los submódulos, y
 * obligarlos a importar este módulo no aportaría nada.
 */
@Global()
@Module({
  providers: [LoggerService, AuditoriaService, AuditoriaRepository],
  exports: [LoggerService, AuditoriaService],
})
export class CommonModule {}
