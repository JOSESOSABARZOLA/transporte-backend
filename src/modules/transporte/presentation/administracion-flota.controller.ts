/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: administracion-flota.controller.ts
 * Responsabilidad: Exponer la administración de conductores y vehículos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * RF-056. **Solo el `ADMINISTRADOR_DMIP`.** La DAF asigna la flota; quién la compone es
 * configuración institucional, igual que el maestro de personal (M-10).
 *
 * SIN `VentanaCargaGuard`, por el mismo motivo que en M-06 y M-10: la ventana gobierna
 * la carga del cuadro, no la administración de catálogos. Un conductor nuevo tiene que
 * poder darse de alta a las siete de la tarde.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { FlotaService } from '../application/flota.service';
import {
  ActualizarConductorDto,
  ActualizarVehiculoDto,
  aConductorResponse,
  aUbicacionResponse,
  ActualizarUbicacionDto,
  CrearUbicacionDto,
  type UbicacionResponseDto,
  aVehiculoResponse,
  CrearConductorDto,
  CrearVehiculoDto,
  type ConductorResponseDto,
  type VehiculoResponseDto,
} from './dto/transporte.dto';

/** Respuesta de una baja lógica, con el motivo redactado para el administrador. */
interface BajaResponseDto<T> {
  registro: T;
  operativosHistoricos: number;
  mensaje: string;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA FLOTA PASA A `ADMINISTRADOR_DAF`, Y SOLO A ÉL. 2026-09-01.
 *
 * Es el primer trabajo real del reparto de la administración: los tres administradores se
 * crearon esa mañana y dos quedaron vacíos. El negocio decidió que **Conductores y
 * vehículos** y **Mantenimiento de vehículos** las vea únicamente el de Vehículos, que es
 * quien conoce la flota.
 *
 * SALE `ADMINISTRADOR_DMIP`, y eso es lo que se pidió: «el único que podrá visualizar».
 * Conviene saber la consecuencia — hasta hoy la flota la administraba el DMIP, así que
 * **alguien tiene que tener el rol `ADMINISTRADOR_DAF` o estas rutas no las abre nadie**.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
@Controller('administracion')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('flota:administrar')
export class AdministracionFlotaController {
  constructor(private readonly flota: FlotaService) {}

  // ─────────────────────────── Conductores ───────────────────────────

  @Get('conductores')
  async listarConductores(
    @Query('incluirInactivos') incluirInactivos?: string,
  ): Promise<ConductorResponseDto[]> {
    const conductores = await this.flota.listarConductores(
      incluirInactivos === 'true',
    );

    return conductores.map(aConductorResponse);
  }

  @Post('conductores')
  async crearConductor(
    @Body() dto: CrearConductorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ id: number; nombreCompleto: string }> {
    const conductor = await this.flota.crearConductor(dto, usuario.usuarioId);

    return { id: conductor.id, nombreCompleto: conductor.nombreCompleto };
  }

  @Patch('conductores/:id')
  async actualizarConductor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarConductorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ id: number; nombreCompleto: string }> {
    const conductor = await this.flota.actualizarConductor(
      id,
      dto,
      usuario.usuarioId,
    );

    return { id: conductor.id, nombreCompleto: conductor.nombreCompleto };
  }

  @Delete('conductores/:id')
  async desactivarConductor(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto<{ id: number; activo: boolean }>> {
    const baja = await this.flota.desactivarConductor(id, usuario.usuarioId);

    return {
      registro: { id: baja.registro.id, activo: baja.registro.activo },
      operativosHistoricos: baja.operativosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  // ─────────────────────────── Vehículos ───────────────────────────

  @Get('vehiculos')
  async listarVehiculos(
    @Query('incluirInactivos') incluirInactivos?: string,
  ): Promise<VehiculoResponseDto[]> {
    const vehiculos = await this.flota.listarVehiculos(
      incluirInactivos === 'true',
    );

    return vehiculos.map(aVehiculoResponse);
  }

  @Post('vehiculos')
  async crearVehiculo(
    @Body() dto: CrearVehiculoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VehiculoResponseDto> {
    return aVehiculoResponse(
      await this.flota.crearVehiculo(dto, usuario.usuarioId),
    );
  }

  @Patch('vehiculos/:id')
  async actualizarVehiculo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarVehiculoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VehiculoResponseDto> {
    return aVehiculoResponse(
      await this.flota.actualizarVehiculo(id, dto, usuario.usuarioId),
    );
  }

  @Delete('vehiculos/:id')
  async desactivarVehiculo(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto<VehiculoResponseDto>> {
    const baja = await this.flota.desactivarVehiculo(id, usuario.usuarioId);

    return {
      registro: aVehiculoResponse(baja.registro),
      operativosHistoricos: baja.operativosHistoricos,
      mensaje: baja.mensaje,
    };
  }

  // ─────────── Ubicaciones de reposo de la flota · RN-DAF-03 ───────────

  /**
   * El catálogo de zonales donde puede quedar un vehículo al terminar la jornada.
   *
   * NACE VACÍO. La evidencia se contradice —cinco zonales en la hoja de agosto, cuatro en
   * la reunión— y es la pregunta Q-01, sin responder. Lo carga el administrador cuando el
   * negocio confirme la lista; sembrarla habría convertido una suposición en dato maestro.
   */
  /*
    ═══════════════════════════════════════════════════════════════════════════════
    LEERLO NO ES ADMINISTRARLO, Y ESTA LÍNEA REPARA UN 403 QUE YA EXISTÍA.

    Este catálogo lo **usa la DAF operativa** en P-03: al declarar dónde queda cada
    vehículo (RN-DAF-03) el desplegable sale de aquí. El controlador entero era de
    `ADMINISTRADOR_DMIP`, así que la DAF recibía **403** al abrir la pantalla —comprobado
    contra el servidor el 2026-09-01—, y como P-03 pide sus cuatro catálogos en un
    `Promise.all`, el rechazo de uno vaciaba los cuatro: **conductores, vehículos, zonales
    y destinos**. La pantalla de asignación quedaba en blanco sin decir por qué.

    Es un defecto anterior a este cambio y se arregla aquí porque es aquí donde vive.

    SOLO LA LECTURA. Crear y desactivar zonales siguen siendo del administrador de la
    flota: la DAF elige de la lista, no la mantiene.
    ═══════════════════════════════════════════════════════════════════════════════
  */
  @Get('ubicaciones-flota')
  @RequierePermiso('flota:administrar')
  async ubicaciones(
    @Query('incluirInactivas') incluirInactivas?: string,
  ): Promise<UbicacionResponseDto[]> {
    const filas = await this.flota.listarUbicaciones(
      incluirInactivas === 'true',
    );
    return filas.map(aUbicacionResponse);
  }

  @Post('ubicaciones-flota')
  async crearUbicacion(
    @Body() dto: CrearUbicacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UbicacionResponseDto> {
    return aUbicacionResponse(
      await this.flota.crearUbicacion(dto.nombre, usuario.usuarioId),
    );
  }

  /**
   * La baja es lógica, igual que en el resto de la flota.
   *
   * `fk_destino_ubicacion` es `ON DELETE RESTRICT`: una zonal usada en un destino ya
   * declarado no se puede borrar sin dejar sin sitio a ese vehículo. Se desactiva y deja
   * de ofrecerse, conservando lo ya declarado.
   */
  @Patch('ubicaciones-flota/:id')
  async actualizarUbicacion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarUbicacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UbicacionResponseDto> {
    return aUbicacionResponse(
      await this.flota.actualizarUbicacion(id, dto, usuario.usuarioId),
    );
  }
}
