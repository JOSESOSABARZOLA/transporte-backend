/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota · mantenimiento
 * Archivo: mantenimiento-semana.controller.ts
 * Responsabilidad: Exponer la vista semanal de vehículos parados por mantenimiento.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Va aparte de `MantenimientoVehiculoController` porque su prefijo es otro
 * (`transporte/mantenimiento`, no `transporte/vehiculos/:id`). Mismo permiso.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { MantenimientoVehiculoService } from '../application/mantenimiento-vehiculo.service';
import type { SemanaDeVehiculo } from '../application/politicas/semana-mantenimiento';

@Controller('transporte/mantenimiento')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('flota:mantenimiento')
export class MantenimientoSemanaController {
  constructor(private readonly mantenimiento: MantenimientoVehiculoService) {}

  /** `GET /transporte/mantenimiento/semana?desde=AAAA-MM-DD` → 7 días por vehículo activo. */
  @Get('semana')
  async semana(@Query('desde') desde?: string): Promise<SemanaDeVehiculo[]> {
    return this.mantenimiento.semana(exigirFecha(desde));
  }
}

function exigirFecha(texto: string | undefined): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto ?? '');
  if (!partes) {
    throw new ValidacionError(
      'Indique desde qué día (desde=AAAA-MM-DD) quiere ver la semana.',
      { desde: texto },
    );
  }
  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { desde: texto });
  }
  return fecha;
}
