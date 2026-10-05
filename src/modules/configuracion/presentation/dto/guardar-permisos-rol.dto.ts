/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración de permisos (RBAC)
 * Archivo: guardar-permisos-rol.dto.ts
 * Responsabilidad: Validar el cuerpo con el conjunto de permisos de un rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 */

import { ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';

export class GuardarPermisosRolDto {
  @ArrayUnique({ message: 'No repita permisos en la lista.' })
  @IsString({ each: true, message: 'Cada permiso es un código de texto.' })
  @MaxLength(60, { each: true })
  @IsArray({ message: 'Envíe la lista de permisos del rol.' })
  permisos: string[];
}
