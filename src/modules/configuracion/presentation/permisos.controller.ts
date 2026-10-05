/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración de permisos (RBAC)
 * Archivo: permisos.controller.ts
 * Responsabilidad: Exponer el catálogo de permisos y la matriz rol<->permiso, editable.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * Cierra el RBAC: quien tiene `permisos:administrar` da o quita accesos a un rol sin
 * desplegar. La autorización se ENFORZA en el servidor (PermisosGuard), como el resto.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { PermisosAdminService } from '../application/permisos-admin.service';
import { GuardarPermisosRolDto } from './dto/guardar-permisos-rol.dto';

interface PermisoResponseDto {
  codigo: string;
  modulo: string;
  descripcion: string;
}

@Controller('administracion')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('permisos:administrar')
export class PermisosController {
  constructor(private readonly permisos: PermisosAdminService) {}

  /** El catálogo de permisos atómicos, agrupable por módulo en la pantalla. */
  @Get('permisos')
  async catalogo(): Promise<PermisoResponseDto[]> {
    const permisos = await this.permisos.catalogo();
    return permisos.map((permiso) => ({
      codigo: permiso.codigo,
      modulo: permiso.modulo,
      descripcion: permiso.descripcion,
    }));
  }

  /** Los permisos que hoy tiene un rol. */
  @Get('roles/:rol/permisos')
  async deRol(@Param('rol') rol: string): Promise<string[]> {
    return this.permisos.deRol(rol);
  }

  /** Reemplaza el conjunto de permisos de un rol; devuelve el resultante. */
  @Put('roles/:rol/permisos')
  async guardar(
    @Param('rol') rol: string,
    @Body() dto: GuardarPermisosRolDto,
  ): Promise<string[]> {
    return this.permisos.guardar(rol, dto.permisos);
  }
}
