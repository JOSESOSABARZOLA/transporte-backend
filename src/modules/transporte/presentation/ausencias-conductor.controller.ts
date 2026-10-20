/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.controller.ts
 * Responsabilidad: Exponer el registro de ausencias de los conductores desde «Flota y garajes».
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * PERMISO PROPIO, `flota:ausencias` (migración 20261016120000). Hoy lo tienen los mismos roles
 * que `flota:administrar` (DAF, ADMINISTRADOR_DAF, ADMINISTRADOR), pero va aparte para poder
 * repartirlo desde «Permisos por rol» sin desplegar: la ausencia puede llevar un motivo de salud.
 *
 * NO LLEVA `VentanaCargaGuard`, por la misma razón que el mantenimiento y la administración de
 * la flota: no es carga del cuadro sino dato maestro de la flota, y un conductor se enferma a la
 * hora que se enferma.
 *
 * SE DECLARA ANTES QUE `AdministracionFlotaController` en el módulo, y `GET conductores/ausencias`
 * no choca con ninguna ruta `conductores/:id` de lectura (aquél solo tiene `:id/impacto-baja`).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { aFechaUtc } from '../../../common/ausencias/reglas-ausencia';
import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { fechaIsoEnZona } from '../../../common/utilidades/marca-tiempo';
import { AusenciasConductorService } from '../application/ausencias-conductor.service';
import {
  aAusenciaConductorResponse,
  aAusenciaDeLaFlotaResponse,
  aTramoAfectadoResponse,
  CrearAusenciaConductorDto,
  FiltroAusenciasFlotaDto,
  type AusenciaConductorRegistradaResponseDto,
  type AusenciaConductorResponseDto,
  type AusenciaDeLaFlotaResponseDto,
} from './dto/ausencias-conductor.dto';

@Controller('administracion/conductores')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('flota:ausencias')
export class AusenciasConductorController {
  constructor(private readonly ausencias: AusenciasConductorService) {}

  /** En curso y próximas de toda la flota, sin motivo: la insignia «Ausente» de la tabla. */
  @Get('ausencias')
  async deLaFlota(
    @Query() filtro: FiltroAusenciasFlotaDto,
  ): Promise<AusenciaDeLaFlotaResponseDto[]> {
    const desde = exigirFecha(filtro.desde ?? fechaIsoEnZona(), 'desde');
    const filas = await this.ausencias.deLaFlota(desde);
    return filas.map((fila) => aAusenciaDeLaFlotaResponse(fila));
  }

  @Get(':id/ausencias')
  async listar(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AusenciaConductorResponseDto[]> {
    const filas = await this.ausencias.listarDe(id);
    return filas.map((fila) => aAusenciaConductorResponse(fila));
  }

  @Post(':id/ausencias')
  async registrar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrearAusenciaConductorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<AusenciaConductorRegistradaResponseDto> {
    const { ausencia, tramosAfectados } = await this.ausencias.registrar(
      id,
      {
        estado: dto.estado,
        desde: exigirFecha(dto.desde, 'desde'),
        hasta: exigirFecha(dto.hasta, 'hasta'),
        motivo: dto.motivo,
      },
      usuario.usuarioId,
    );

    return {
      ...aAusenciaConductorResponse(ausencia),
      tramosAfectados: tramosAfectados.map(aTramoAfectadoResponse),
    };
  }

  @Delete(':id/ausencias/:periodoId')
  async retirar(
    @Param('id', ParseIntPipe) id: number,
    @Param('periodoId', ParseIntPipe) periodoId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ retirada: boolean }> {
    await this.ausencias.retirar(id, periodoId, usuario.usuarioId);
    return { retirada: true };
  }
}

/** `@db.Date` se interpreta en UTC; una fecha que no existe (31 de febrero) es un 400. */
function exigirFecha(texto: string, campo: string): Date {
  const fecha = aFechaUtc(texto);
  if (!fecha) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, {
      [campo]: texto,
    });
  }
  return fecha;
}
