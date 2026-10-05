/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso (RBAC)
 * Archivo: permisos.repository.ts
 * Responsabilidad: Leer y escribir la matriz rol<->permiso y el catálogo de permisos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * Único punto que toca `t_permiso` / `t_rol_permiso`. La lectura de la matriz la consume
 * `PermisosGuard` (cacheada en el servicio); la escritura, la administración de permisos.
 */

import { Injectable } from '@nestjs/common';
import type { Permiso, RolDepartamental } from '@prisma/client';

import { RepositorioPrisma } from '../../persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Una fila de la matriz: qué permiso tiene qué rol. */
export interface FilaRolPermiso {
  rol: RolDepartamental;
  permisoCodigo: string;
}

@Injectable()
export class PermisosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** La matriz completa, para armar la caché rol -> permisos. */
  async matrizCompleta(): Promise<FilaRolPermiso[]> {
    return this.prisma.rolPermiso.findMany({
      select: { rol: true, permisoCodigo: true },
    });
  }

  /** El catálogo de permisos activos, para la pantalla de administración. */
  async listarPermisos(): Promise<Permiso[]> {
    return this.prisma.permiso.findMany({
      where: { activo: true },
      orderBy: [{ modulo: 'asc' }, { codigo: 'asc' }],
    });
  }

  /** Los permisos de un rol concreto. */
  async permisosDeRol(rol: RolDepartamental): Promise<string[]> {
    const filas = await this.prisma.rolPermiso.findMany({
      where: { rol },
      select: { permisoCodigo: true },
    });
    return filas.map((fila) => fila.permisoCodigo);
  }

  /** Reemplaza atómicamente el conjunto de permisos de un rol. */
  async reemplazarPermisosDeRol(
    rol: RolDepartamental,
    permisos: string[],
  ): Promise<void> {
    await this.ejecutarEnTransaccion(async (tx) => {
      await tx.rolPermiso.deleteMany({ where: { rol } });
      if (permisos.length > 0) {
        await tx.rolPermiso.createMany({
          data: permisos.map((permisoCodigo) => ({ rol, permisoCodigo })),
          skipDuplicates: true,
        });
      }
    });
  }
}
