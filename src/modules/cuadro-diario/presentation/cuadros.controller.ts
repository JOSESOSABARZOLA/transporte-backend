/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: cuadros.controller.ts
 * Responsabilidad: Exponer la apertura, la consulta, el cierre y la reapertura.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * TRES ROLES, TRES ALCANCES:
 *
 *   · Apertura        `ADMINISTRADOR_DMIP`
 *   · Cierre y reapertura  **solo `DIRECTOR`**
 *   · Consulta        todos los roles autenticados
 *
 * El cierre es el acto por el que la Dirección se hace responsable del cuadro del día:
 * que un departamento pudiera cerrarlo dejaría a la Dirección firmando algo que no
 * revisó. Es el caso 8 del plan y la razón de que el decorador lleve un solo rol.
 *
 * SIN `VentanaCargaGuard`. La ventana gobierna la carga de operativos, no el ciclo de
 * vida de la jornada: precisamente el cierre ocurre CUANDO las ventanas ya vencieron.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { CuadroDiarioService } from '../application/cuadro-diario.service';
import {
  aCuadroResponse,
  CrearCuadroDto,
  type CuadroResponseDto,
} from './dto/cuadro.dto';

@Controller('cuadros')
@UseGuards(IdentidadGuard, PermisosGuard)
export class CuadrosController {
  constructor(private readonly cuadros: CuadroDiarioService) {}

  /** RN-05. Un solo cuadro por fecha. */
  @Post()
  @RequierePermiso('cuadro:abrir')
  async abrir(
    @Body() dto: CrearCuadroDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CuadroResponseDto> {
    return aCuadroResponse(
      await this.cuadros.abrir(exigirFecha(dto.fecha), usuario.usuarioId),
    );
  }

  /**
   * Estado de la jornada. Lo consulta la cabecera de todas las pantallas, así que lo
   * ven todos los roles: saber si el cuadro sigue abierto no es información reservada.
   *
   * De paso **sincroniza el estado con las ventanas**, de modo que quien abre una
   * pantalla ve la situación real y no la que quedó guardada la última vez.
   */
  @Get(':fecha')
  async obtener(@Param('fecha') fecha: string): Promise<CuadroResponseDto> {
    return aCuadroResponse(
      await this.cuadros.sincronizarConVentanas(exigirFecha(fecha)),
    );
  }

  /** CU-10. Solo la Dirección. */
  @Post(':fecha/cerrar')
  @RequierePermiso('cuadro:cerrar-reabrir')
  @HttpCode(HttpStatus.OK)
  async cerrar(
    @Param('fecha') fecha: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CuadroResponseDto> {
    return aCuadroResponse(
      await this.cuadros.cerrar(exigirFecha(fecha), usuario.usuarioId),
    );
  }

  /** PV-11. Endpoint con verificación de rol, sin flujo de autorización adicional. */
  @Post(':fecha/reabrir')
  @RequierePermiso('cuadro:cerrar-reabrir')
  @HttpCode(HttpStatus.OK)
  async reabrir(
    @Param('fecha') fecha: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CuadroResponseDto> {
    return aCuadroResponse(
      await this.cuadros.reabrir(exigirFecha(fecha), usuario.usuarioId),
    );
  }
}

/**
 * Interpreta la fecha de la ruta en UTC.
 *
 * `cuad_fecha` es `@db.Date`: una fecha de calendario. Interpretarla con el huso del
 * proceso desplazaría la jornada un día en cualquier servidor al oeste de Greenwich, y
 * Quito lo está. Mismo criterio que en M-10 y M-11.
 */
function exigirFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);

  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }

  return fecha;
}
