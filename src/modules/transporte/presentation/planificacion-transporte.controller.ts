/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: planificacion-transporte.controller.ts
 * Responsabilidad: Exponer el plan del día, los tramos, la evaluación y la activación de libres.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Misma cadena que `TransporteController` —identidad, permiso y ventana de carga de la DAF— y el
 * mismo permiso `transporte:asignar` para todo: es la misma persona haciendo el mismo trabajo, con
 * otra herramienta. No hay permiso nuevo que sembrar.
 *
 * `POST /transporte/evaluar` y `POST /transporte/evaluar/vehiculos` no escriben; son POST porque el
 * bloque viaja en el cuerpo.
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
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { VentanaCargaGuard } from '../../../common/auth/guards/ventana-carga.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { Autor } from '../../operativos/application/operativos.service';
import {
  PlanificacionTransporteService,
  type EvaluacionConductor,
  type EvaluacionDeVehiculos,
} from '../application/planificacion-transporte.service';
import {
  ActivarConductorDto,
  AsignarBloqueDto,
  BloqueOperativosDto,
  CompartirUnidadDto,
  EvaluarVehiculosDto,
  FechaDto,
} from './dto/planificacion.dto';

@Controller('transporte')
@UseGuards(IdentidadGuard, PermisosGuard, VentanaCargaGuard)
@RequierePermiso('transporte:asignar')
export class PlanificacionTransporteController {
  constructor(private readonly planificacion: PlanificacionTransporteService) {}

  /** La línea de tiempo del día: operativos con su cadena, tramos, conductores y vehículos. */
  @Get('planificacion/:fecha')
  async plan(@Param('fecha') fecha: string) {
    return this.planificacion.planDelDia(exigirFecha(fecha));
  }

  /** Dónde amanece, dónde queda y si está en taller cada vehículo. */
  @Get('ubicaciones/:fecha')
  async ubicaciones(@Param('fecha') fecha: string) {
    return this.planificacion.ubicacionesDelDia(exigirFecha(fecha));
  }

  /** ✓ / ⚠ / ✕ de cada conductor para un bloque, ordenados por estado y costo. No escribe. */
  @Post('evaluar')
  @HttpCode(HttpStatus.OK)
  async evaluar(
    @Body() dto: BloqueOperativosDto,
  ): Promise<EvaluacionConductor[]> {
    return this.planificacion.evaluarBloque(
      exigirFecha(dto.fecha),
      dto.operativoIds,
      dto.tramoIds,
    );
  }

  /**
   * Cada placa activa del día para un conductor y un bloque, con su ✓ / ⚠ / ✕ y el motivo (taller,
   * asientos, placa con otro conductor). Para elegir otra que la propuesta. No escribe.
   */
  @Post('evaluar/vehiculos')
  @HttpCode(HttpStatus.OK)
  async evaluarVehiculos(
    @Body() dto: EvaluarVehiculosDto,
  ): Promise<EvaluacionDeVehiculos> {
    return this.planificacion.evaluarVehiculos(
      exigirFecha(dto.fecha),
      dto.operativoIds,
      dto.tramoIds,
      dto.conductorId,
    );
  }

  /** Genera los tramos de los operativos del día que aún no tienen. Idempotente. */
  @Post('tramos/generar')
  @HttpCode(HttpStatus.OK)
  async generar(
    @Body() dto: FechaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ generados: number }> {
    return this.planificacion.generarTramosDelDia(
      exigirFecha(dto.fecha),
      comoAutor(usuario),
    );
  }

  /** Vuelve a generar los tramos de un operativo (ninguno puede estar asignado). */
  @Post('tramos/operativo/:operativoId/regenerar')
  @HttpCode(HttpStatus.OK)
  async regenerar(
    @Param('operativoId', ParseIntPipe) operativoId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ generados: number }> {
    return this.planificacion.regenerarTramos(operativoId, comoAutor(usuario));
  }

  /**
   * Asigna un bloque (o unos tramos) a un conductor y vehículo. 409 ASIGNACION_NO_VIABLE si ✕. Si
   * alguno de esos tramos era anfitrión de una unidad compartida, `liberados` y `aviso` dicen
   * quiénes quedaron sin conductor (2026-10-19).
   */
  @Post('tramos/asignar')
  @HttpCode(HttpStatus.OK)
  async asignar(
    @Body() dto: AsignarBloqueDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.planificacion.asignarBloque(
      {
        fecha: exigirFecha(dto.fecha),
        operativoIds: dto.operativoIds,
        tramoIds: dto.tramoIds,
        conductorId: dto.conductorId,
        vehiculoId: dto.vehiculoId ?? null,
      },
      comoAutor(usuario),
    );
  }

  /**
   * Quita conductor y vehículo de un tramo (vuelve a «por cubrir»). Desde el 2026-10-19 responde
   * 200 con `{ liberados, aviso }`: si el tramo era anfitrión de una unidad compartida, quienes
   * viajaban con él también quedan sin conductor. Antes era 204 sin cuerpo.
   */
  @Delete('tramos/:id/asignacion')
  @HttpCode(HttpStatus.OK)
  async quitar(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.planificacion.quitarTramo(id, comoAutor(usuario));
  }

  /**
   * Compartir unidad (2026-10-19): el invitado viaja con el conductor y la placa del anfitrión.
   * 409 COMPARTIR_NO_COMPATIBLE con el motivo si no van juntos (tipo, hora, lugar, asientos,
   * exclusivo); 409 ASIGNACION_NO_VIABLE si RN-44/RN-25 lo impiden al conductor.
   */
  @Post('tramos/compartir')
  @HttpCode(HttpStatus.OK)
  async compartir(
    @Body() dto: CompartirUnidadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.planificacion.compartirUnidad(
      {
        operativoId: dto.operativoId,
        anfitrionOperativoId: dto.anfitrionOperativoId,
      },
      comoAutor(usuario),
    );
  }

  /** Con qué operativos ya asignados puede compartir unidad uno (el pedido primero). No escribe. */
  @Get('tramos/:operativoId/compartibles')
  async compartibles(@Param('operativoId', ParseIntPipe) operativoId: number) {
    return this.planificacion.compartibles(operativoId);
  }

  /** Activa a un conductor LIBRE ese día (horas extra), con su motivo. */
  @Post('activaciones')
  @HttpCode(HttpStatus.NO_CONTENT)
  async activar(
    @Body() dto: ActivarConductorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.planificacion.activarLibre(
      dto.conductorId,
      exigirFecha(dto.fecha),
      dto.motivo,
      comoAutor(usuario),
    );
  }

  @Delete('activaciones/:conductorId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async desactivar(
    @Param('conductorId', ParseIntPipe) conductorId: number,
    @Query('fecha') fecha: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.planificacion.desactivarLibre(
      conductorId,
      exigirFecha(fecha),
      comoAutor(usuario),
    );
  }
}

function comoAutor(usuario: UsuarioAutenticado): Autor {
  return { usuarioId: usuario.usuarioId, rol: usuario.rol };
}

/** `@db.Date` se interpreta en UTC, igual que el resto del módulo. */
function exigirFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? '');
  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      {
        fecha: texto,
      },
    );
  }
  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }
  return fecha;
}
