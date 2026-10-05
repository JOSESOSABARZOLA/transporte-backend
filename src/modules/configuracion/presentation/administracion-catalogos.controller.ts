/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administracion-catalogos.controller.ts
 * Responsabilidad: Exponer la administración de puntos, tipos de control e instituciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * PER · Exclusivo del ADMINISTRADOR_DMIP. El catálogo es el marco dentro del cual los
 * departamentos registran: quien lo edita decide qué opciones existen para todos.
 *
 * SIN `VentanaCargaGuard`, por el mismo motivo que en M-06: la ventana gobierna la
 * jornada del cuadro, no la administración del sistema.
 *
 * `DELETE` DESACTIVA, NO BORRA (RF-058 e INV-22). La ruta se conserva porque es la
 * que el administrador espera; la respuesta explica qué ocurrió realmente y cuántos
 * operativos anteriores usan el valor.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { CatalogosService } from '../application/catalogos.service';
import {
  ActualizarInstitucionDto,
  ActualizarPuntoDto,
  ActualizarTipoControlDto,
  ActualizarZonalDto,
  CrearInstitucionDto,
  CrearPuntoDto,
  CrearTipoControlDto,
  CrearZonalDto,
} from './dto/administrar-catalogos.dto';
import {
  aCatalogosResponse,
  aInstitucionResponse,
  aPuntoResponse,
  aTipoControlResponse,
  aZonalResponse,
  type CatalogosFormularioResponseDto,
  type InstitucionResponseDto,
  type PuntoResponseDto,
  type TipoControlResponseDto,
  type ZonalResponseDto,
} from './dto/catalogos-response.dto';

/** Respuesta de una baja lógica: qué quedó y por qué no se eliminó. */
interface BajaResponseDto {
  id: number;
  activo: boolean;
  usosHistoricos: number;
  mensaje: string;
}

/** Respuesta de una baja FÍSICA (eliminación definitiva). */
interface EliminacionResponseDto {
  id: number;
  mensaje: string;
}

@Controller('administracion/catalogos')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('catalogos:administrar')
export class AdministracionCatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  /**
   * PV-36. Los catálogos del formulario INCLUYENDO LOS DESACTIVADOS, para poder
   * reactivarlos. El registro de operativos lee por `GET /formularios/:codigo/catalogos`,
   * que solo devuelve lo vigente; este camino es exclusivo de la administración y por eso
   * cuelga de este controlador, tras el mismo `@Roles`.
   */
  @Get(':codigo')
  async catalogosParaAdministrar(
    @Param('codigo') codigo: string,
  ): Promise<CatalogosFormularioResponseDto> {
    return aCatalogosResponse(
      await this.catalogos.obtenerCatalogosAdmin(codigo),
    );
  }

  // ─────────────────────────── Zonales ───────────────────────────
  //
  // La zonal dejó de ser un catálogo cerrado el 2026-09-04. El código no viaja en el
  // cuerpo: se autogenera del nombre en el servicio. Al actualizar solo cambian el nombre
  // y el estado; el código queda fijo tras crearse.

  @Post('zonales')
  async crearZonal(
    @Body() dto: CrearZonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ZonalResponseDto> {
    return aZonalResponse(
      await this.catalogos.crearZonal(dto, usuario.usuarioId),
    );
  }

  @Put('zonales/:id')
  async actualizarZonal(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarZonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ZonalResponseDto> {
    return aZonalResponse(
      await this.catalogos.actualizarZonal(id, dto, usuario.usuarioId),
    );
  }

  @Delete('zonales/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarZonal(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    const baja = await this.catalogos.desactivarZonal(id, usuario.usuarioId);
    return {
      id: baja.registro.id,
      activo: baja.registro.activo,
      usosHistoricos: baja.usosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  /** Baja FÍSICA. Solo si la zonal nunca se usó y no tiene puntos; si no, 409. */
  @Delete('zonales/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarZonal(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarZonal(id, usuario.usuarioId);
  }

  // ─────────────────────────── Puntos ───────────────────────────

  @Post('puntos')
  async crearPunto(
    @Body() dto: CrearPuntoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PuntoResponseDto> {
    return aPuntoResponse(
      await this.catalogos.crearPunto(dto, usuario.usuarioId),
    );
  }

  @Put('puntos/:id')
  async actualizarPunto(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarPuntoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PuntoResponseDto> {
    return aPuntoResponse(
      await this.catalogos.actualizarPunto(id, dto, usuario.usuarioId),
    );
  }

  @Delete('puntos/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarPunto(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    const baja = await this.catalogos.desactivarPunto(id, usuario.usuarioId);
    return {
      id: baja.registro.id,
      activo: baja.registro.activo,
      usosHistoricos: baja.usosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  /** Baja FÍSICA. Solo si el punto nunca se usó; si no, 409. */
  @Delete('puntos/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarPunto(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarPunto(id, usuario.usuarioId);
  }

  // ─────────────────────── Tipos de control ───────────────────────

  @Post('tipos-control')
  async crearTipoControl(
    @Body() dto: CrearTipoControlDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TipoControlResponseDto> {
    return aTipoControlResponse(
      await this.catalogos.crearTipoControl(dto, usuario.usuarioId),
    );
  }

  @Put('tipos-control/:id')
  async actualizarTipoControl(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarTipoControlDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TipoControlResponseDto> {
    return aTipoControlResponse(
      await this.catalogos.actualizarTipoControl(id, dto, usuario.usuarioId),
    );
  }

  @Delete('tipos-control/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarTipoControl(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    const baja = await this.catalogos.desactivarTipoControl(
      id,
      usuario.usuarioId,
    );
    return {
      id: baja.registro.id,
      activo: baja.registro.activo,
      usosHistoricos: baja.usosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  /** Baja FÍSICA. Solo si el tipo de control nunca se usó; si no, 409. */
  @Delete('tipos-control/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarTipoControl(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarTipoControl(id, usuario.usuarioId);
  }

  // ─────────────────────── Instituciones ───────────────────────

  @Post('instituciones')
  async crearInstitucion(
    @Body() dto: CrearInstitucionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<InstitucionResponseDto> {
    return aInstitucionResponse(
      await this.catalogos.crearInstitucion(dto, usuario.usuarioId),
    );
  }

  @Put('instituciones/:id')
  async actualizarInstitucion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarInstitucionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<InstitucionResponseDto> {
    return aInstitucionResponse(
      await this.catalogos.actualizarInstitucion(id, dto, usuario.usuarioId),
    );
  }

  @Delete('instituciones/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarInstitucion(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    const baja = await this.catalogos.desactivarInstitucion(
      id,
      usuario.usuarioId,
    );
    return {
      id: baja.registro.id,
      activo: baja.registro.activo,
      usosHistoricos: baja.usosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  /** Baja FÍSICA. Solo si la institución nunca se usó; si no, 409. */
  @Delete('instituciones/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarInstitucion(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarInstitucion(id, usuario.usuarioId);
  }
}
