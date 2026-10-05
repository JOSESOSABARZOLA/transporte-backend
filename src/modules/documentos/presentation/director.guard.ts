/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: director.guard.ts
 * Responsabilidad: Exigir el rol DIRECTOR en los endpoints de la Dirección de órdenes de servicio.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXCEPCIÓN DELIBERADA A LA REGLA 4 (acceso por PERMISO, no por rol).
 *
 * El acceso a la pantalla lo sigue dando el permiso `ordenes:gestionar` (`PermisosGuard`). Pero la
 * matriz rol↔permiso es EDITABLE en «Permisos por rol», y el módulo de órdenes es del DIRECTOR por
 * regla de negocio: la orden la firma él, con SU plantilla (plantilla por Director, 2026-10-05). Si
 * alguien otorgara el permiso a otro rol, ese usuario entraría a firmar con una plantilla que no es
 * suya. Por eso, ADEMÁS del permiso, aquí se exige el rol —la misma razón que ya aplicaba `emitir`
 * (F21)—. Va DESPUÉS de `IdentidadGuard` (que llena `request.user`) y de `PermisosGuard`.
 *
 * No se aplica a `GET /ordenes-servicio/mias` ni a `/:codigo/documento`: esos son del destinatario.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { RolDepartamental } from '@prisma/client';

import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { AutorizacionError } from '../../../common/errors/errores-dominio';

@Injectable()
export class DirectorGuard implements CanActivate {
  canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto
      .switchToHttp()
      .getRequest<{ user?: UsuarioAutenticado }>();
    const roles = peticion.user?.roles ?? [];

    if (!roles.includes(RolDepartamental.DIRECTOR)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.ROL_NO_AUTORIZADO,
        'Las órdenes de servicio son de la Dirección: solo un Director puede gestionarlas.',
      );
    }

    return true;
  }
}
