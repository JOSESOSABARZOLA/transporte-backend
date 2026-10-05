/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: administracion-usuarios.controller.ts
 * Responsabilidad: Exponer el alta y el mantenimiento de las cuentas del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * EXCLUSIVO DEL ADMINISTRADOR_DMIP, y es el endpoint más delicado del sistema: decide quién
 * entra y con qué rol. Un alta hacia DIRECTOR da acceso a la matriz consolidada entera,
 * que es exactamente la información cuyo filtrado originó el proyecto.
 *
 * SIN `VentanaCargaGuard`: la ventana gobierna la jornada del cuadro, no la
 * administración del sistema. Mismo criterio que catálogos, ventanas y roles de Auth.
 *
 * `DELETE` DESACTIVA, NO BORRA. Las filas de auditoría guardan el identificador de quien
 * hizo cada cambio; borrar la cuenta las dejaría apuntando a nadie, y la auditoría es
 * evidencia.
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
import { UsuariosAdminService } from '../application/usuarios-admin.service';
import type { CuentaAdministrada } from '../infrastructure/usuarios-admin.repository';
import {
  ActualizarUsuarioDto,
  CrearUsuarioDto,
} from './dto/administrar-usuarios.dto';

/** Una cuenta, tal como la ve la pantalla. */
interface UsuarioResponseDto {
  id: number;
  correo: string;
  nombre: string;
  /** Todos los roles de la persona. Ve la unión de los formularios de cada uno. */
  roles: RolDepartamental[];
  /** Usuario de Auth central. Sin él, esa persona no puede entrar. */
  identificadorAd: string | null;
  /** Ficha de personal enlazada. Sin ella, P-06 «Mis órdenes» no funciona. */
  funcionario: {
    cedula: string;
    nombreCompleto: string;
  } | null;
  activo: boolean;
}

const aResponse = (cuenta: CuentaAdministrada): UsuarioResponseDto => ({
  id: cuenta.id,
  correo: cuenta.correo,
  nombre: cuenta.nombre,
  roles: cuenta.roles.map((fila) => fila.rol),
  identificadorAd: cuenta.identificadorAd,
  funcionario: cuenta.funcionario
    ? {
        cedula: cuenta.funcionario.cedula,
        nombreCompleto: `${cuenta.funcionario.apellidos} ${cuenta.funcionario.nombres}`,
      }
    : null,
  activo: cuenta.activo,
});

@Controller('administracion/usuarios')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('usuarios:administrar')
export class AdministracionUsuariosController {
  constructor(private readonly servicio: UsuariosAdminService) {}

  @Get()
  async listar(): Promise<UsuarioResponseDto[]> {
    const cuentas = await this.servicio.listar();
    return cuentas.map(aResponse);
  }

  @Post()
  async crear(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body() cuerpo: CrearUsuarioDto,
  ): Promise<UsuarioResponseDto> {
    const creada = await this.servicio.crear(usuario.usuarioId, usuario.rol, {
      correo: cuerpo.correo,
      nombre: cuerpo.nombre,
      roles: cuerpo.roles,
      identificadorAd: cuerpo.identificadorAd ?? null,
      funcionarioCedula: cuerpo.funcionarioCedula ?? null,
    });
    return aResponse(creada);
  }

  @Put(':id')
  async actualizar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
    @Body() cuerpo: ActualizarUsuarioDto,
  ): Promise<UsuarioResponseDto> {
    const actualizada = await this.servicio.actualizar(
      usuario.usuarioId,
      usuario.rol,
      id,
      cuerpo,
    );
    return aResponse(actualizada);
  }

  @Delete(':id')
  async desactivar(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<UsuarioResponseDto> {
    const desactivada = await this.servicio.desactivar(
      usuario.usuarioId,
      usuario.rol,
      id,
    );
    return aResponse(desactivada);
  }
}
