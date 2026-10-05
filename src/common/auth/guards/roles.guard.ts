/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: N/A
 * Archivo: roles.guard.ts
 * Responsabilidad: Ver la descripción del elemento exportado.
 * Desarrollador:
 * Fecha: 24/03/2026
 */

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthUser } from '../interfaces/auth-user.interface';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles =
      this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const requiredPermissions =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    if (!requiredRoles.length && !requiredPermissions.length) {
      return true;
    }

    // `rol` es opcional a propósito: `AuthUser` es el contrato heredado y esta guarda
    // debe seguir sirviendo a quien no tenga la identidad completa de este módulo.
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthUser & { rol?: string } }>();
    const user = request.user;

    if (!user) {
      return false;
    }

    const userRoles = user.roles ?? [];
    const userPermissions = user.permissions ?? [];

    const rolesOk =
      !requiredRoles.length ||
      requiredRoles.some((requiredRole) => userRoles.includes(requiredRole));

    const permissionsOk =
      !requiredPermissions.length ||
      requiredPermissions.every((permission) =>
        userPermissions.includes(permission),
      );

    // ESTRECHA EL ROL EFECTIVO al primero que el endpoint admite y la persona tiene.
    //
    // Desde que alguien puede tener varios roles, «con que rol hace esto» deja de ser
    // evidente. Quien tenga DAF y DMIP Operativos y llame a un endpoint de la DAF lo hace
    // como DAF, y eso es lo que debe quedar en la auditoria: grabar el primero de su lista
    // diria que la DAF asigno transporte «como DMIP Operativos».
    //
    // Si el endpoint no declara roles no hay nada que estrechar: cualquiera de los suyos
    // vale, y se conserva el de partida.
    if (rolesOk && requiredRoles.length > 0) {
      const efectivo = requiredRoles.find((requerido) =>
        userRoles.includes(requerido),
      );
      if (efectivo !== undefined) {
        user.rol = efectivo;
      }
    }

    return rolesOk && permissionsOk;
  }
}
