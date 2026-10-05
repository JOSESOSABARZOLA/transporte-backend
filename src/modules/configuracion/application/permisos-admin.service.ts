/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración de permisos (RBAC)
 * Archivo: permisos-admin.service.ts
 * Responsabilidad: Publicar el catálogo de permisos y reescribir la matriz de un rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * Es la meta del RBAC: dar o quitar accesos a un rol pasa a ser una escritura de datos, sin
 * desplegar. Al guardar se invalida la caché de `PermisosService`, así que el cambio surte
 * efecto en la siguiente petición. Reescribe el conjunto completo del rol (idempotente).
 *
 * NO AUDITA TODAVÍA: `t_auditoria` indexa por `entidadId` numérico y la clave aquí es un rol
 * (texto del enum). Queda anotado para sumar una traza propia de la matriz.
 */

import { Injectable } from '@nestjs/common';
import { RolDepartamental, type Permiso } from '@prisma/client';

import { PermisosService } from '../../../common/auth/application/permisos.service';
import { PermisosRepository } from '../../../common/auth/infrastructure/permisos.repository';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';

@Injectable()
export class PermisosAdminService {
  constructor(
    private readonly repositorio: PermisosRepository,
    private readonly permisos: PermisosService,
  ) {}

  /** El catálogo de permisos atómicos, para pintar la matriz. */
  async catalogo(): Promise<Permiso[]> {
    return this.repositorio.listarPermisos();
  }

  /** Los permisos que hoy tiene un rol. */
  async deRol(rol: string): Promise<string[]> {
    return this.repositorio.permisosDeRol(this.exigirRol(rol));
  }

  /** Reemplaza el conjunto de permisos de un rol e invalida la caché de autorización. */
  async guardar(rol: string, permisosCodigos: string[]): Promise<string[]> {
    const rolValido = this.exigirRol(rol);

    // Solo se aceptan permisos del catálogo: uno inexistente rompería la FK, pero avisar
    // aquí da un mensaje entendible en vez de un error del motor.
    const catalogo = new Set(
      (await this.repositorio.listarPermisos()).map((p) => p.codigo),
    );
    const desconocidos = permisosCodigos.filter((c) => !catalogo.has(c));
    if (desconocidos.length > 0) {
      throw new ValidacionError(
        `Estos permisos no existen: ${desconocidos.join(', ')}.`,
        { desconocidos },
      );
    }

    await this.repositorio.reemplazarPermisosDeRol(rolValido, permisosCodigos);
    this.permisos.invalidarCache();
    return this.repositorio.permisosDeRol(rolValido);
  }

  private exigirRol(rol: string): RolDepartamental {
    if (!(rol in RolDepartamental)) {
      throw new RecursoNoEncontradoError(`No existe el rol ${rol}.`, { rol });
    }
    return rol as RolDepartamental;
  }
}
