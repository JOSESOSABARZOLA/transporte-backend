/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.controller.ts
 * Responsabilidad: Exponer la declaración y la consulta de capacidad.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * DOS ROLES DISTINTOS PARA CADA COSA, y así lo pide el plan:
 *
 *   · **Declarar** es de la `DAF` —que conoce su flota— y del `ADMINISTRADOR_DMIP`.
 *   · **Consultar** es de la `DAF` y del `DIRECTOR`, que revisa la jornada antes de
 *     cerrarla. El `ADMINISTRADOR_DMIP` declara pero no necesita el indicador operativo.
 *
 * SIN `VentanaCargaGuard`. Declarar la flota disponible no es cargar el cuadro: la DAF
 * tiene que poder corregir el número cuando un vehículo entra al taller a las seis de la
 * tarde. Mismo criterio que la administración de catálogos en M-06 y M-10.
 *
 * `PUT` Y NO `POST`: el recurso es la capacidad **de esa fecha** y solo hay una. Declarar
 * dos veces deja el mismo resultado que declarar una, que es el caso 4 del plan.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { CapacidadFlotaService } from '../application/capacidad-flota.service';
import {
  aCapacidadResponse,
  DeclararCapacidadDto,
  type CapacidadResponseDto,
} from './dto/capacidad.dto';

@Controller('transporte/capacidad')
@UseGuards(IdentidadGuard, PermisosGuard)
export class CapacidadFlotaController {
  constructor(private readonly capacidad: CapacidadFlotaService) {}

  /** POL-07. El indicador de P-03 y de la cabecera de P-04. */
  @Get(':fecha')
  @RequierePermiso('flota:capacidad:ver')
  async consultar(
    @Param('fecha') fecha: string,
  ): Promise<CapacidadResponseDto> {
    return aCapacidadResponse(
      await this.capacidad.verificarDemanda(exigirFecha(fecha)),
    );
  }

  /** RF-057. La DAF declara cuántos vehículos y conductores tiene hábiles. */
  @Put(':fecha')
  @RequierePermiso('flota:capacidad:declarar')
  async declarar(
    @Param('fecha') fecha: string,
    @Body() dto: DeclararCapacidadDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<CapacidadResponseDto> {
    return aCapacidadResponse(
      await this.capacidad.declarar(exigirFecha(fecha), dto, {
        usuarioId: usuario.usuarioId,
        rol: usuario.rol,
      }),
    );
  }
}

/** Mismo criterio que en M-13, M-14, M-16 y M-17: `@db.Date` se interpreta en UTC. */
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
