/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · operación diaria de la flota (Fase 5)
 * Archivo: operacion-flota.controller.ts
 * Responsabilidad: Exponer el checklist diario, el kilometraje y los vales de combustible.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * NO LLEVA `VentanaCargaGuard`, por la misma razón que `MantenimientoVehiculoController`: no es
 * carga del cuadro sino registro de la operación de la flota, y ocurre a la hora en que el vehículo
 * sale o vuelve (el checklist es a las 05H00, el vale cuando se entrega). Lo escribe la DAF con el
 * permiso que ya tiene, `transporte:asignar`.
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { OperacionFlotaService } from '../application/operacion-flota.service';
import {
  ChecklistDto,
  KilometrajeDto,
  ValeCombustibleDto,
} from './dto/planificacion.dto';

const fechaTexto = (fecha: Date): string => fecha.toISOString().slice(0, 10);

@Controller('transporte')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('transporte:asignar')
export class OperacionFlotaController {
  constructor(private readonly operacion: OperacionFlotaService) {}

  /** Art. 9. Registra (o corrige) el checklist de un vehículo y conductor en el día. */
  @Post('checklist')
  async checklist(
    @Body() dto: ChecklistDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const fila = await this.operacion.registrarChecklist(
      {
        vehiculoId: dto.vehiculoId,
        conductorId: dto.conductorId,
        fecha: exigirFecha(dto.fecha),
        items: dto.items,
        observacion: dto.observacion ?? null,
        kilometrajeSalida: dto.kilometrajeSalida ?? null,
      },
      usuario.usuarioId,
    );
    return { ...fila, fecha: fechaTexto(fila.fecha) };
  }

  @Get('checklist/:fecha')
  async checklists(@Param('fecha') fecha: string) {
    const filas = await this.operacion.checklistsDe(exigirFecha(fecha));
    return filas.map((f) => ({
      id: f.id,
      vehiculoId: f.vehiculoId,
      placa: f.vehiculo.placa,
      conductorId: f.conductorId,
      conductor: f.conductor.nombreCompleto,
      fecha: fechaTexto(f.fecha),
      items: f.items,
      observacion: f.observacion,
      kilometrajeSalida: f.kilometrajeSalida,
    }));
  }

  /** Lectura del kilometraje del día (una por vehículo y día). */
  @Post('kilometraje')
  async kilometraje(
    @Body() dto: KilometrajeDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const fila = await this.operacion.registrarKilometraje(
      {
        vehiculoId: dto.vehiculoId,
        conductorId: dto.conductorId ?? null,
        fecha: exigirFecha(dto.fecha),
        kilometraje: dto.kilometraje,
      },
      usuario.usuarioId,
    );
    return { ...fila, fecha: fechaTexto(fila.fecha) };
  }

  @Get('vehiculos/:id/kilometraje')
  async historialKilometraje(@Param('id', ParseIntPipe) id: number) {
    const filas = await this.operacion.historialKilometraje(id);
    return filas.map((f) => ({
      id: f.id,
      fecha: fechaTexto(f.fecha),
      kilometraje: f.kilometraje,
      conductorId: f.conductorId,
    }));
  }

  /** Vale de combustible ($10 o $20). */
  @Post('vales')
  async vale(
    @Body() dto: ValeCombustibleDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    const fila = await this.operacion.registrarVale(
      {
        conductorId: dto.conductorId,
        vehiculoId: dto.vehiculoId,
        fecha: exigirFecha(dto.fecha),
        monto: dto.monto,
        numero: dto.numero ?? null,
      },
      usuario.usuarioId,
    );
    return { ...fila, fecha: fechaTexto(fila.fecha) };
  }

  @Get('vales/:fecha')
  async vales(@Param('fecha') fecha: string) {
    const filas = await this.operacion.valesDe(exigirFecha(fecha));
    return filas.map((f) => ({
      id: f.id,
      conductorId: f.conductorId,
      conductor: f.conductor.nombreCompleto,
      vehiculoId: f.vehiculoId,
      placa: f.vehiculo.placa,
      fecha: fechaTexto(f.fecha),
      monto: f.monto,
      numero: f.numero,
    }));
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
