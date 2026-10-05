/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso (RBAC)
 * Archivo: permisos.guard.ts
 * Responsabilidad: Autorizar un endpoint contra los permisos del perfil, leídos de la BD.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * REEMPLAZA A `RolesGuard`. Lee el permiso que el endpoint exige (`@RequierePermiso`) y lo
 * compara contra los permisos efectivos del perfil, que salen de la matriz `t_rol_permiso`
 * (cacheada en `PermisosService`). El servidor sigue siendo la autoridad: aquí se ENFORCE,
 * no se confía en el frontend.
 *
 * SOMBRERO DE AUDITORÍA. `RolesGuard` estrechaba `usuario.rol` al rol con el que se ejerce
 * la acción. Se conserva ese estrechamiento: al rol del perfil que otorga el permiso. Para
 * las escrituras de operativo, `FormularioRolGuard` lo vuelve a fijar después (dueño del
 * formulario), como antes.
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CODIGOS_ERROR } from '../../errors/codigos-error';
import { AutorizacionError } from '../../errors/errores-dominio';
import type { UsuarioAutenticado } from '../interfaces/usuario-autenticado.interface';
import { PERMISO_KEY } from '../decorators/requiere-permiso.decorator';
import { PermisosService } from '../application/permisos.service';

@Injectable()
export class PermisosGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requeridos =
      this.reflector.getAllAndOverride<string[]>(PERMISO_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // Sin permiso declarado no hay nada que exigir: el endpoint queda con la sola
    // autenticación (mismo criterio que hoy tienen los controladores sin `@Roles`).
    if (requeridos.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ user?: UsuarioAutenticado }>();
    const usuario = request.user;
    if (!usuario) return false;

    const suyos = await this.permisos.permisosDeRoles(usuario.roles ?? []);
    const autorizado = requeridos.every((permiso) => suyos.has(permiso));

    if (!autorizado) {
      throw new AutorizacionError(
        CODIGOS_ERROR.PERMISO_INSUFICIENTE,
        'Su perfil no tiene el permiso necesario para realizar esta acción.',
        { permisos: requeridos },
      );
    }

    // Estrecha el «sombrero» de auditoría al rol que otorga el permiso.
    const efectivo = await this.permisos.rolConAlguno(
      usuario.roles ?? [],
      requeridos,
    );
    if (efectivo !== undefined) usuario.rol = efectivo;

    return true;
  }
}
