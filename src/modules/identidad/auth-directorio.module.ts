/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: auth-directorio.module.ts
 * Responsabilidad: Publicar el acceso al directorio de Auth central sin arrastrar la sesión.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * POR QUÉ UN MÓDULO APARTE. `IdentidadModule` importa `TalentoOperativoModule` (el directorio
 * cruza Auth con las fichas). Desde el rediseño de P-07, el alta de una ficha de origen AUTH
 * necesita a su vez preguntarle a Auth el correo institucional: si `talento-operativo`
 * importara `IdentidadModule` habría un ciclo. Este módulo no depende de nadie, lo importan
 * los dos y publica solo lo imprescindible.
 */

import { Module } from '@nestjs/common';

import { CorreoInstitucionalAuthService } from './application/correo-institucional-auth.service';
import { AuthUsuariosClient } from './infrastructure/auth-usuarios.client';

@Module({
  providers: [AuthUsuariosClient, CorreoInstitucionalAuthService],
  exports: [AuthUsuariosClient, CorreoInstitucionalAuthService],
})
export class AuthDirectorioModule {}
