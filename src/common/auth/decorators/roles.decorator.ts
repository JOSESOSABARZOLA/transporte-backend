/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: N/A
 * Archivo: roles.decorator.ts
 * Responsabilidad: Ver la descripción del elemento exportado.
 * Desarrollador:
 * Fecha: 24/03/2026
 */

import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
