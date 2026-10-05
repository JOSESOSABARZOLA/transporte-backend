/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso (RBAC)
 * Archivo: requiere-permiso.decorator.ts
 * Responsabilidad: Declarar el permiso atómico que un endpoint exige.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * Reemplaza a `@Roles(...)`: en vez de nombrar roles, el endpoint nombra el PERMISO que
 * hace falta (`modulo:accion`). Quién tiene ese permiso lo decide la matriz `t_rol_permiso`
 * en la base, leída por `PermisosGuard`, no una lista escrita en el código.
 */

import { SetMetadata } from '@nestjs/common';

export const PERMISO_KEY = 'permiso_requerido';

/** Exige que el perfil tenga TODOS los permisos indicados (normalmente uno). */
export const RequierePermiso = (...permisos: string[]) =>
  SetMetadata(PERMISO_KEY, permisos);
