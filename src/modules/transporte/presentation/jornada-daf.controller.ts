/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.controller.ts
 * Responsabilidad: Exponer el resumen de la jornada, los candidatos, los vehículos que salen y la emisión de hojas de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * SIN `VentanaCargaGuard`, y es deliberado (mismo criterio que la preparación y la capacidad):
 *   · el resumen y los candidatos son LECTURAS que la analista necesita también con la ventana
 *     cerrada, para revisar en modo lectura;
 *   · confirmar los vehículos es declarar la capacidad del día, que ya vivía fuera de la ventana
 *     (un vehículo puede entrar al taller a las seis de la tarde);
 *   · emitir la hoja de ruta no cambia ninguna asignación: deja constancia de qué se entregó.
 * Las asignaciones siguen pasando por los endpoints de planificación, que sí llevan la guarda.
 *
 * HORAS LIBRES (2026-10-14): `GET /transporte/huecos/:fecha` y el atajo por conductor
 * `GET /transporte/conductores/:id/huecos-libres?fecha=` son LECTURAS (sin ventana, igual que el
 * resumen) con `transporte:asignar`.
 *
 * PERMISOS QUE YA EXISTEN: `transporte:asignar` (resumen, candidatos, huecos, emitir) y
 * `flota:capacidad:ver` / `flota:capacidad:declarar` (vehículos que salen). No hay permiso nuevo.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { JornadaDafService } from '../application/jornada-daf.service';
import {
  CandidatosQueryDto,
  ConfirmarVehiculosDto,
  EmitirHojasDto,
  HuecosConductorQueryDto,
  HuecosQueryDto,
} from './dto/jornada-daf.dto';

@Controller('transporte')
@UseGuards(IdentidadGuard, PermisosGuard)
export class JornadaDafController {
  constructor(private readonly jornada: JornadaDafService) {}

  /** Todo el flujo de «Planificar el día» en una llamada. El paso se deriva de aquí. */
  @Get('jornada-daf/:fecha')
  @RequierePermiso('transporte:asignar')
  async resumen(@Param('fecha') fecha: string) {
    return this.jornada.resumen(exigirFecha(fecha));
  }

  /** Conductores para un operativo, por categoría y con su motivo. */
  @Get('candidatos/:operativoId')
  @RequierePermiso('transporte:asignar')
  async candidatos(
    @Param('operativoId', ParseIntPipe) operativoId: number,
    @Query() consulta: CandidatosQueryDto,
  ) {
    return this.jornada.candidatos(exigirFecha(consulta.fecha), operativoId);
  }

  /**
   * Las horas libres del día (2026-10-14): por conductor y por vehículo, con lo que mide cada hueco
   * (bruto, útil mínimo y, con `zonalId`, aprovechable para un servicio en esa zonal).
   */
  @Get('huecos/:fecha')
  @RequierePermiso('transporte:asignar')
  async huecos(
    @Param('fecha') fecha: string,
    @Query() consulta: HuecosQueryDto,
  ) {
    return this.jornada.huecosDelDia(exigirFecha(fecha), {
      conductorId: consulta.conductorId,
      vehiculoId: consulta.vehiculoId,
      zonalId: consulta.zonalId,
    });
  }

  /** Atajo: las horas libres de UN conductor (la misma consulta, filtrada). */
  @Get('conductores/:id/huecos-libres')
  @RequierePermiso('transporte:asignar')
  async huecosDelConductor(
    @Param('id', ParseIntPipe) conductorId: number,
    @Query() consulta: HuecosConductorQueryDto,
  ) {
    return this.jornada.huecosDelConductor(
      exigirFecha(consulta.fecha),
      conductorId,
      consulta.zonalId,
    );
  }

  /** Qué vehículos salen ese día (o `sale: null` si aún no se confirmó). */
  @Get('vehiculos-jornada/:fecha')
  @RequierePermiso('flota:capacidad:ver')
  async vehiculos(@Param('fecha') fecha: string) {
    return this.jornada.vehiculosDeJornada(exigirFecha(fecha));
  }

  /** Confirma la lista de los que salen y declara el conteo (RN-46). */
  @Put('vehiculos-jornada/:fecha')
  @RequierePermiso('flota:capacidad:declarar')
  async confirmarVehiculos(
    @Param('fecha') fecha: string,
    @Body() dto: ConfirmarVehiculosDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.jornada.confirmarVehiculos(
      exigirFecha(fecha),
      { saleIds: dto.saleIds, observacion: dto.observacion ?? null },
      { usuarioId: usuario.usuarioId, rol: usuario.rol },
    );
  }

  /** Emite la hoja de ruta de un conductor, o de todos si no se indica. */
  @Post('hojas-ruta/:fecha/emitir')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('transporte:asignar')
  async emitir(
    @Param('fecha') fecha: string,
    @Body() dto: EmitirHojasDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.jornada.emitirHojas(exigirFecha(fecha), dto.conductorId, {
      usuarioId: usuario.usuarioId,
      rol: usuario.rol,
    });
  }
}

/** `@db.Date` se interpreta en UTC, igual que el resto del módulo. */
function exigirFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? '');
  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }
  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }
  return fecha;
}
