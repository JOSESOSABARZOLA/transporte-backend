/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Homologación de roles
 * Archivo: administracion-roles-auth.controller.ts
 * Responsabilidad: Exponer la administración de la correspondencia con los roles de Auth.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * EXCLUSIVO DEL ADMINISTRADOR_DMIP, y con más motivo que los catálogos: quien edita esta
 * tabla decide qué rol del Cuadro de Colores recibe cada persona que entra desde Auth.
 * Equivocarse hacia DIRECTOR significa dar acceso a la matriz consolidada entera.
 *
 * SIN `VentanaCargaGuard`, por el mismo motivo que en los catálogos y las ventanas: la
 * ventana gobierna la jornada del cuadro, no la administración del sistema.
 *
 * `DELETE` DESACTIVA, NO BORRA. La fila se conserva porque explica por qué una cuenta
 * dada de alta en su día recibió el rol que recibió; borrarla dejaría esa decisión sin
 * justificación. La respuesta avisa si era la última correspondencia de ese rol.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { RolDepartamental } from '@prisma/client';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { RolesAuthService } from '../application/roles-auth.service';
import {
  ActualizarRolAuthDto,
  CrearRolAuthDto,
} from './dto/administrar-roles-auth.dto';

/** Una correspondencia, tal como la ve la pantalla. */
interface RolAuthResponseDto {
  idAuth: number;
  nombreAuth: string;
  rol: RolDepartamental;
  subsistema: number;
  activo: boolean;
}

/** El panorama completo: lo registrado y lo que falta. */
interface PanoramaResponseDto {
  correspondencias: RolAuthResponseDto[];
  /**
   * Roles del módulo sin rol de Auth activo.
   *
   * Se devuelve para que el hueco SE VEA en la pantalla, en vez de descubrirse cuando
   * alguien no puede entrar. Hoy contiene `FUNCIONARIO`: Auth creó los seis roles
   * departamentales y no el séptimo, y sin él P-06 «Mis órdenes» es inaccesible.
   */
  sinCorrespondencia: RolDepartamental[];
}

/** Resultado de una baja: qué quedó, y si con ella un rol se quedó sin camino. */
interface BajaResponseDto {
  idAuth: number;
  activo: boolean;
  mensaje: string;
}

const aResponse = (fila: {
  idAuth: number;
  nombreAuth: string;
  rol: RolDepartamental;
  subsistema: number;
  activo: boolean;
}): RolAuthResponseDto => ({
  idAuth: fila.idAuth,
  nombreAuth: fila.nombreAuth,
  rol: fila.rol,
  subsistema: fila.subsistema,
  activo: fila.activo,
});

@Controller('administracion/roles-auth')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('roles-auth:administrar')
export class AdministracionRolesAuthController {
  constructor(private readonly servicio: RolesAuthService) {}

  @Get()
  async consultar(): Promise<PanoramaResponseDto> {
    const panorama = await this.servicio.consultar();
    return {
      correspondencias: panorama.correspondencias.map(aResponse),
      sinCorrespondencia: panorama.sinCorrespondencia,
    };
  }

  @Post()
  async crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() cuerpo: CrearRolAuthDto,
  ): Promise<RolAuthResponseDto> {
    const creado = await this.servicio.crear(usuario.usuarioId, usuario.rol, {
      idAuth: cuerpo.idAuth,
      nombreAuth: cuerpo.nombreAuth,
      rol: cuerpo.rol,
      subsistema: cuerpo.subsistema ?? 11,
    });
    return aResponse(creado);
  }

  @Put(':idAuth')
  async actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('idAuth', ParseIntPipe) idAuth: number,
    @Body() cuerpo: ActualizarRolAuthDto,
  ): Promise<RolAuthResponseDto> {
    const actualizado = await this.servicio.actualizar(
      usuario.usuarioId,
      usuario.rol,
      idAuth,
      cuerpo,
    );
    return aResponse(actualizado);
  }

  @Delete(':idAuth')
  async desactivar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('idAuth', ParseIntPipe) idAuth: number,
  ): Promise<BajaResponseDto> {
    const { rolAuth, eraLaUnica } = await this.servicio.desactivar(
      usuario.usuarioId,
      usuario.rol,
      idAuth,
    );

    return {
      idAuth: rolAuth.idAuth,
      activo: rolAuth.activo,
      mensaje: eraLaUnica
        ? `La correspondencia quedó desactivada. Era la única de ${rolAuth.rol}: ` +
          'a partir de ahora nadie podrá entrar con ese rol desde Auth central.'
        : 'La correspondencia quedó desactivada. El rol conserva otras vías de acceso.',
    };
  }
}
