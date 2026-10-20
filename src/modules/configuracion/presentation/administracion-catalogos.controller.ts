/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administracion-catalogos.controller.ts
 * Responsabilidad: Exponer la administración de zonales, puntos, tipos de control e instituciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * PER · Exclusivo del ADMINISTRADOR_DMIP. El catálogo es el marco dentro del cual los
 * departamentos registran: quien lo edita decide qué opciones existen para todos.
 *
 * SIN `VentanaCargaGuard`, por el mismo motivo que en M-06: la ventana gobierna la
 * jornada del cuadro, no la administración del sistema.
 *
 * TODO CUELGA DEL FORMULARIO (2026-10-13): `/administracion/catalogos/:codigo/…`. Cada formulario
 * tiene su configuración propia e independiente; el valor se crea en el formulario de la ruta, y
 * editar, desactivar o eliminar un valor de OTRO formulario responde 404. Se retiraron las rutas
 * sin formulario, `GET zonales` global y las copias (`POST …/:id/copias`).
 *
 * LAS ZONALES SE IDENTIFICAN POR SU ZONA DE LA CIUDAD (`:zonaId`), única dentro del formulario:
 * es el `zonalId` que llevan sus puntos y sus operativos.
 *
 * `DELETE` DESACTIVA, NO BORRA (RF-058 e INV-22). La respuesta explica qué ocurrió realmente y
 * cuántos operativos anteriores usan el valor. El borrado de verdad es `DELETE …/permanente`,
 * solo para lo que nunca se usó (409 si no).
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
import {
  CatalogosService,
  type ResultadoBaja,
} from '../application/catalogos.service';
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
  aCatalogosAdminResponse,
  aInstitucionResponse,
  aPuntoResponse,
  aTipoControlResponse,
  aZonalAdminResponse,
  aZonalResponse,
  type CatalogosAdminResponseDto,
  type InstitucionResponseDto,
  type PuntoResponseDto,
  type TipoControlResponseDto,
  type ZonalAdminResponseDto,
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

const aBaja = (
  baja: ResultadoBaja<{ id: number; activo: boolean }>,
): BajaResponseDto => ({
  id: baja.registro.id,
  activo: baja.registro.activo,
  usosHistoricos: baja.usosHistoricos,
  mensaje: baja.mensaje,
});

@Controller('administracion/catalogos')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('catalogos:administrar')
export class AdministracionCatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  /**
   * PV-36. Los catálogos del formulario INCLUYENDO LOS DESACTIVADOS, para poder
   * reactivarlos. El registro de operativos lee por `GET /formularios/:codigo/catalogos`,
   * que solo devuelve lo vigente.
   */
  @Get(':codigo')
  async catalogosParaAdministrar(
    @Param('codigo') codigo: string,
  ): Promise<CatalogosAdminResponseDto> {
    return aCatalogosAdminResponse(
      await this.catalogos.obtenerCatalogosAdmin(codigo),
    );
  }

  // ─────────────────────────── Zonales ───────────────────────────

  /** Las zonales DEL FORMULARIO, con las desactivadas, sus puntos y sus usos en él. */
  @Get(':codigo/zonales')
  async zonalesParaAdministrar(
    @Param('codigo') codigo: string,
  ): Promise<ZonalAdminResponseDto[]> {
    return (await this.catalogos.listarZonalesAdmin(codigo)).map(
      aZonalAdminResponse,
    );
  }

  /** Las zonas de la ciudad que el formulario aún no tiene: lo que ofrece el alta de una zonal. */
  @Get(':codigo/zonas-disponibles')
  async zonasDisponibles(
    @Param('codigo') codigo: string,
  ): Promise<ZonalResponseDto[]> {
    return (await this.catalogos.zonasDisponibles(codigo)).map(aZonalResponse);
  }

  @Post(':codigo/zonales')
  async crearZonal(
    @Param('codigo') codigo: string,
    @Body() dto: CrearZonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ZonalAdminResponseDto> {
    return aZonalAdminResponse(
      await this.catalogos.crearZonal(codigo, dto, usuario.usuarioId),
    );
  }

  @Put(':codigo/zonales/:zonaId')
  async actualizarZonal(
    @Param('codigo') codigo: string,
    @Param('zonaId', ParseIntPipe) zonaId: number,
    @Body() dto: ActualizarZonalDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ZonalResponseDto> {
    return aZonalResponse(
      await this.catalogos.actualizarZonal(
        codigo,
        zonaId,
        dto,
        usuario.usuarioId,
      ),
    );
  }

  @Delete(':codigo/zonales/:zonaId')
  @HttpCode(HttpStatus.OK)
  async desactivarZonal(
    @Param('codigo') codigo: string,
    @Param('zonaId', ParseIntPipe) zonaId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    return aBaja(
      await this.catalogos.desactivarZonal(codigo, zonaId, usuario.usuarioId),
    );
  }

  /** Baja FÍSICA de la zonal DEL FORMULARIO: solo si en él nunca se usó y no tiene puntos; si no, 409. */
  @Delete(':codigo/zonales/:zonaId/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarZonal(
    @Param('codigo') codigo: string,
    @Param('zonaId', ParseIntPipe) zonaId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarZonal(codigo, zonaId, usuario.usuarioId);
  }

  // ─────────────────────────── Puntos ───────────────────────────

  @Post(':codigo/puntos')
  async crearPunto(
    @Param('codigo') codigo: string,
    @Body() dto: CrearPuntoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PuntoResponseDto> {
    return aPuntoResponse(
      await this.catalogos.crearPunto(codigo, dto, usuario.usuarioId),
    );
  }

  @Put(':codigo/puntos/:id')
  async actualizarPunto(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarPuntoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<PuntoResponseDto> {
    return aPuntoResponse(
      await this.catalogos.actualizarPunto(codigo, id, dto, usuario.usuarioId),
    );
  }

  @Delete(':codigo/puntos/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarPunto(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    return aBaja(
      await this.catalogos.desactivarPunto(codigo, id, usuario.usuarioId),
    );
  }

  /** Baja FÍSICA. Solo si el punto nunca se usó; si no, 409. */
  @Delete(':codigo/puntos/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarPunto(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarPunto(codigo, id, usuario.usuarioId);
  }

  // ─────────────────────── Tipos de control ───────────────────────

  @Post(':codigo/tipos-control')
  async crearTipoControl(
    @Param('codigo') codigo: string,
    @Body() dto: CrearTipoControlDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TipoControlResponseDto> {
    return aTipoControlResponse(
      await this.catalogos.crearTipoControl(codigo, dto, usuario.usuarioId),
    );
  }

  @Put(':codigo/tipos-control/:id')
  async actualizarTipoControl(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarTipoControlDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TipoControlResponseDto> {
    return aTipoControlResponse(
      await this.catalogos.actualizarTipoControl(
        codigo,
        id,
        dto,
        usuario.usuarioId,
      ),
    );
  }

  @Delete(':codigo/tipos-control/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarTipoControl(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    return aBaja(
      await this.catalogos.desactivarTipoControl(codigo, id, usuario.usuarioId),
    );
  }

  /** Baja FÍSICA. Solo si el tipo de control nunca se usó; si no, 409. */
  @Delete(':codigo/tipos-control/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarTipoControl(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarTipoControl(codigo, id, usuario.usuarioId);
  }

  // ─────────────────────── Instituciones ───────────────────────

  @Post(':codigo/instituciones')
  async crearInstitucion(
    @Param('codigo') codigo: string,
    @Body() dto: CrearInstitucionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<InstitucionResponseDto> {
    return aInstitucionResponse(
      await this.catalogos.crearInstitucion(codigo, dto, usuario.usuarioId),
    );
  }

  @Put(':codigo/instituciones/:id')
  async actualizarInstitucion(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarInstitucionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<InstitucionResponseDto> {
    return aInstitucionResponse(
      await this.catalogos.actualizarInstitucion(
        codigo,
        id,
        dto,
        usuario.usuarioId,
      ),
    );
  }

  @Delete(':codigo/instituciones/:id')
  @HttpCode(HttpStatus.OK)
  async desactivarInstitucion(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto> {
    return aBaja(
      await this.catalogos.desactivarInstitucion(codigo, id, usuario.usuarioId),
    );
  }

  /** Baja FÍSICA. Solo si la institución nunca se usó; si no, 409. */
  @Delete(':codigo/instituciones/:id/permanente')
  @HttpCode(HttpStatus.OK)
  async eliminarInstitucion(
    @Param('codigo') codigo: string,
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<EliminacionResponseDto> {
    return this.catalogos.eliminarInstitucion(codigo, id, usuario.usuarioId);
  }
}
