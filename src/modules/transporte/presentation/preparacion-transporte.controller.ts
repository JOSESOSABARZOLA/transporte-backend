/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · planificar el día
 * Archivo: preparacion-transporte.controller.ts
 * Responsabilidad: Exponer la lista «Antes de asignar» de una fecha.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * SIN `VentanaCargaGuard`, y es deliberado: es una LECTURA que la analista necesita justamente
 * ANTES de que su ventana abra, para saber qué le falta. Va en un controlador aparte para no
 * heredar la guarda de ventana de `PlanificacionTransporteController`.
 */

import { Controller, Get, Param, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { Preparacion } from '../application/politicas/preparacion-dia';
import { PreparacionTransporteService } from '../application/preparacion-transporte.service';

@Controller('transporte/preparacion')
@UseGuards(IdentidadGuard, PermisosGuard)
export class PreparacionTransporteController {
  constructor(private readonly preparacion: PreparacionTransporteService) {}

  @Get(':fecha')
  @RequierePermiso('transporte:asignar')
  async preparar(@Param('fecha') fecha: string): Promise<Preparacion> {
    return this.preparacion.preparar(exigirFecha(fecha));
  }
}

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
