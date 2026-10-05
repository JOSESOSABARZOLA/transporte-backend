/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: parametros.controller.ts
 * Responsabilidad: Exponer la consulta y la modificación de los umbrales de política.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Sin reglas de negocio y sin acceso a datos: recibe, delega y devuelve.
 *
 * NO LLEVA VentanaCargaGuard, y es deliberado. La ventana de carga gobierna la
 * jornada del cuadro —quién puede registrar operativos y hasta qué hora—, no la
 * administración del sistema. Además, aplicarla aquí crearía un cepo: si alguna vez
 * se activara la ventana del ADMINISTRADOR_DMIP, quedaría sin poder abrir la pantalla que
 * configura precisamente las ventanas, y no habría forma de recuperarse desde la
 * aplicación.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { AutorizacionError } from '../../../common/errors/errores-dominio';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { ParametroPoliticaService } from '../application/parametro-politica.service';
import { puedeVerParametro } from '../application/alcance-parametro';
import {
  aParametroResponse,
  type ParametroResponseDto,
} from './dto/parametro-response.dto';
import { ActualizarParametroDto } from './dto/actualizar-parametro.dto';

/**
 * PER · La configuración de política la administran el ADMINISTRADOR_DMIP y el
 * ADMINISTRADOR general, salvo las ventanas de los turnos de la cobertura, que son del
 * ADMINISTRADOR_DMIT. Cada rol ve solo lo suyo (ver `alcance-parametro.ts`).
 */
@Controller('parametros')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('parametros:administrar')
export class ParametrosController {
  constructor(private readonly servicio: ParametroPoliticaService) {}

  @Get()
  async listar(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ParametroResponseDto[]> {
    const parametros = await this.servicio.listar();
    return parametros
      .filter((parametro) => puedeVerParametro(parametro.clave, usuario.roles))
      .map(aParametroResponse);
  }

  @Get(':clave')
  async obtener(
    @Param('clave') clave: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ParametroResponseDto> {
    this.exigirAlcance(clave, usuario);
    return aParametroResponse(await this.servicio.obtener(clave));
  }

  @Put(':clave')
  async actualizar(
    @Param('clave') clave: string,
    @Body() dto: ActualizarParametroDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ParametroResponseDto> {
    this.exigirAlcance(clave, usuario);
    const actualizado = await this.servicio.actualizar(
      clave,
      dto.valor,
      usuario.usuarioId,
    );
    return aParametroResponse(actualizado);
  }

  /** El rol pasó la guarda del controlador, pero este parámetro no es de su alcance. */
  private exigirAlcance(clave: string, usuario: UsuarioAutenticado): void {
    if (!puedeVerParametro(clave, usuario.roles)) {
      throw new AutorizacionError(
        CODIGOS_ERROR.ROL_NO_AUTORIZADO,
        `Su rol no administra el parámetro ${clave}.`,
        { clave },
      );
    }
  }
}
