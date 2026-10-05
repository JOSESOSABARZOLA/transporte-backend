/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: N/A
 * Archivo: permissions.decorator.ts
 * Responsabilidad: Ver la descripción del elemento exportado.
 * Desarrollador:
 * Fecha: 24/03/2026
 */

import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
