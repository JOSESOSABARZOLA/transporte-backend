/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · optimizador, fin del día e insumo de movilización
 * Archivo: optimizacion-transporte.controller.ts
 * Responsabilidad: Exponer «Cubrir al máximo», la priorización, la tarea de taller, el fin del día y la hoja de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * MISMA CADENA QUE LA PLANIFICACIÓN (identidad, permiso y ventana de carga de la DAF) y PERMISOS QUE
 * YA EXISTEN: `transporte:asignar` para todo lo que asigna, `transporte:destinos:ver` /
 * `transporte:destino:fijar` para el fin del día —es la misma declaración de destino de
 * `PUT /transporte/vehiculos/:id/destino/:fecha`, en lote—. No hay permiso nuevo que sembrar.
 *
 * `POST /transporte/optimizar` NO guarda asignaciones: es POST porque genera los tramos que falten
 * (idempotente) y porque las opciones viajan en el cuerpo. Guardar es `/optimizar/confirmar`.
 * Con `simular: true` (2026-10-08) ni siquiera genera tramos: compara sin/con libres en memoria.
 * Sigue bajo la ventana de la DAF: con la ventana cerrada no hay nada que sugerir asignar.
 */

import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { VentanaCargaGuard } from '../../../common/auth/guards/ventana-carga.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { Autor } from '../../operativos/application/operativos.service';
import {
  OptimizacionTransporteService,
  type ResultadoConfirmacion,
} from '../application/optimizacion-transporte.service';
import {
  PlanificacionTransporteService,
  type EvaluacionConductor,
} from '../application/planificacion-transporte.service';
import {
  AsignarTareaDto,
  ConfirmarOptimizacionDto,
  GuardarFinDelDiaDto,
  OptimizarDto,
  PriorizacionDto,
} from './dto/planificacion.dto';

@Controller('transporte')
@UseGuards(IdentidadGuard, PermisosGuard, VentanaCargaGuard)
export class OptimizacionTransporteController {
  constructor(
    private readonly optimizacion: OptimizacionTransporteService,
    private readonly planificacion: PlanificacionTransporteService,
  ) {}

  /** «Cubrir al máximo»: la propuesta del día. No guarda asignaciones. */
  @Post('optimizar')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('transporte:asignar')
  async optimizar(
    @Body() dto: OptimizarDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    if (dto.simular === true) {
      return this.optimizacion.simular(exigirFecha(dto.fecha), {
        compartirCarro: dto.compartirCarro ?? true,
      });
    }
    return this.optimizacion.proponer(
      exigirFecha(dto.fecha),
      {
        activarLibres: dto.activarLibres ?? false,
        compartirCarro: dto.compartirCarro ?? true,
      },
      comoAutor(usuario),
    );
  }

  /** Aplica la propuesta (re-evaluada) en una transacción. */
  @Post('optimizar/confirmar')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('transporte:asignar')
  async confirmar(
    @Body() dto: ConfirmarOptimizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoConfirmacion> {
    return this.optimizacion.confirmar(
      exigirFecha(dto.fecha),
      {
        asignaciones: dto.asignaciones.map((a) => ({
          tramoIds: a.tramoIds,
          conductorId: a.conductorId,
          vehiculoId: a.vehiculoId ?? null,
        })),
        activaciones: dto.activaciones ?? [],
        compartidos: dto.compartidos ?? [],
        estrategia: dto.estrategia ?? null,
      },
      comoAutor(usuario),
    );
  }

  /** «Pedir priorización» de un operativo sin recurso (reutiliza la solicitud de apoyo). */
  @Post('priorizacion')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('transporte:asignar')
  async priorizar(
    @Body() dto: PriorizacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.optimizacion.pedirPriorizacion(
      dto.operativoId,
      dto.opciones ?? [],
      dto.motivo?.trim() || null,
      comoAutor(usuario),
    );
  }

  /** Asigna la TAREA «Llevar a taller» a un conductor. 409 ASIGNACION_NO_VIABLE si ✕. */
  @Post('tramos/tarea/:id/asignar')
  @HttpCode(HttpStatus.OK)
  @RequierePermiso('transporte:asignar')
  async asignarTarea(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AsignarTareaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ evaluacion: EvaluacionConductor }> {
    return this.planificacion.asignarTarea(
      id,
      dto.conductorId,
      comoAutor(usuario),
    );
  }

  /** Puntos 17–18: guarda final sugerida de cada vehículo que salió ese día. */
  @Get('fin-del-dia/:fecha')
  @RequierePermiso('transporte:destinos:ver')
  async finDelDia(@Param('fecha') fecha: string) {
    return this.optimizacion.finDelDia(exigirFecha(fecha));
  }

  /** Declara la guarda final de varios vehículos; una que falle no impide las demás. */
  @Put('fin-del-dia/:fecha')
  @RequierePermiso('transporte:destino:fijar')
  async guardarFinDelDia(
    @Param('fecha') fecha: string,
    @Body() dto: GuardarFinDelDiaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.optimizacion.guardarFinDelDia(
      exigirFecha(fecha),
      dto.guardas.map((g) => ({
        vehiculoId: g.vehiculoId,
        tipo: g.tipo,
        ubicacionId: g.ubicacionId ?? null,
        conductorId: g.conductorId ?? null,
        observacion: g.observacion ?? null,
        actaNumero: g.actaNumero ?? null,
      })),
      usuario.usuarioId,
    );
  }

  /** Insumo de la orden de movilización (sin número: la orden oficial la emite otro sistema). */
  @Get('movilizacion/:fecha/vehiculo/:vehiculoId/json')
  @RequierePermiso('transporte:asignar')
  async hojaRuta(
    @Param('fecha') fecha: string,
    @Param('vehiculoId', ParseIntPipe) vehiculoId: number,
  ) {
    return this.optimizacion.hojaRuta(exigirFecha(fecha), vehiculoId);
  }

  @Get('movilizacion/:fecha/vehiculo/:vehiculoId')
  @RequierePermiso('transporte:asignar')
  @Header('Content-Type', 'application/pdf')
  async hojaRutaPdf(
    @Param('fecha') fecha: string,
    @Param('vehiculoId', ParseIntPipe) vehiculoId: number,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const contenido = await this.optimizacion.hojaRutaPdf(
      exigirFecha(fecha),
      vehiculoId,
    );
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="hoja-ruta-${vehiculoId}-${fecha}.pdf"`,
    );
    return new StreamableFile(contenido);
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
