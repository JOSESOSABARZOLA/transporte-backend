/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso (RBAC)
 * Archivo: permisos.service.ts
 * Responsabilidad: Resolver los permisos efectivos de un perfil desde la matriz rol<->permiso.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * ES LA AUTORIDAD DE ACCESO, Y SE LEE EN CADA PETICIÓN, así que la matriz se guarda en
 * memoria (patrón de `ParametroPoliticaService`) y se invalida al modificarla. Sin caché,
 * cada endpoint iría a la base a preguntar qué permisos tiene el perfil.
 */

import { Injectable } from '@nestjs/common';
import type { RolDepartamental } from '@prisma/client';

import { PermisosRepository } from '../infrastructure/permisos.repository';

@Injectable()
export class PermisosService {
  /** Caché rol -> permisos. Se invalida por completo ante cualquier cambio de la matriz. */
  private cache: Map<RolDepartamental, Set<string>> | null = null;

  constructor(private readonly repositorio: PermisosRepository) {}

  /** Los permisos efectivos de un perfil: la UNIÓN de los de todos sus roles. */
  async permisosDeRoles(
    roles: readonly RolDepartamental[],
  ): Promise<Set<string>> {
    const matriz = await this.cargar();
    const union = new Set<string>();
    for (const rol of roles) {
      const suyos = matriz.get(rol);
      if (suyos) for (const permiso of suyos) union.add(permiso);
    }
    return union;
  }

  /**
   * El primer rol del perfil (en su orden) que otorga alguno de los permisos requeridos.
   *
   * Sirve para el «sombrero» de auditoría: reproduce lo que hacía `RolesGuard` al estrechar
   * `usuario.rol` al rol con el que se ejerce la acción. Devuelve `undefined` si ninguno lo
   * otorga (no debería ocurrir tras autorizar).
   */
  async rolConAlguno(
    roles: readonly RolDepartamental[],
    requeridos: readonly string[],
  ): Promise<RolDepartamental | undefined> {
    const matriz = await this.cargar();
    return roles.find((rol) => {
      const suyos = matriz.get(rol);
      return suyos !== undefined && requeridos.some((p) => suyos.has(p));
    });
  }

  /** Invalida la caché. Lo llama la administración tras reescribir la matriz de un rol. */
  invalidarCache(): void {
    this.cache = null;
  }

  private async cargar(): Promise<Map<RolDepartamental, Set<string>>> {
    if (this.cache) return this.cache;

    const filas = await this.repositorio.matrizCompleta();
    const matriz = new Map<RolDepartamental, Set<string>>();
    for (const fila of filas) {
      const suyos = matriz.get(fila.rol) ?? new Set<string>();
      suyos.add(fila.permisoCodigo);
      matriz.set(fila.rol, suyos);
    }
    this.cache = matriz;
    return matriz;
  }
}
