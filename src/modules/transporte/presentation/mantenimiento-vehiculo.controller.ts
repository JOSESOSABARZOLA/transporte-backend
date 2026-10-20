/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Mantenimiento de vehículos
 * Archivo: mantenimiento-vehiculo.controller.ts
 * Responsabilidad: Exponer el registro de paradas de taller de la flota.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO LLEVA `VentanaCargaGuard`, Y HAY QUE JUSTIFICARLO.
 *
 * La regla 9 de CLAUDE.md dice que `AdicionalesController` es **el único endpoint de
 * escritura sin `VentanaCargaGuard`**, así que un segundo controlador sin esa guarda pide
 * explicación.
 *
 * Esa regla habla de las escrituras DEL CUADRO: registrar un operativo, asignarle
 * personal, resolverle el transporte. Eso es lo que la ventana ordena, repartiendo el día
 * entre departamentos. El mantenimiento no es carga del cuadro: es **dato maestro de la
 * flota**, de la misma clase que dar de alta un vehículo o un conductor, y
 * `AdministracionFlotaController` —que escribe los dos— tampoco la lleva, desde M-17.
 *
 * Y hay una razón operativa que lo decide sin ambigüedad: **un vehículo se avería a la
 * hora que se avería**. Con la guarda puesta, un taller que llama a las nueve de la mañana
 * no se podría registrar hasta las tres de la tarde, y durante esas seis horas la DAF
 * estaría asignando una placa que no existe. La ventana protege el reparto del cuadro; no
 * tiene nada que decir sobre cuándo se rompe una camioneta.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LO ESCRIBEN LA DAF Y EL ADMINISTRADOR_DMIP. La DAF porque es quien recibe el aviso del taller
 * y quien sufre la consecuencia; el Administrador porque mantiene el catálogo de flota. No
 * lo escribe ningún rol departamental: la placa parada no es asunto suyo.
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
import { ValidacionError } from '../../../common/errors/errores-dominio';
import {
  MantenimientoVehiculoService,
  type TramoAfectadoPorParada,
} from '../application/mantenimiento-vehiculo.service';
import {
  aMantenimientoResponse,
  CambiarEstadoMantenimientoDto,
  CrearMantenimientoDto,
  type MantenimientoResponseDto,
} from './dto/transporte.dto';

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL MANTENIMIENTO PASA A `ADMINISTRADOR_DAF`, Y SOLO A ÉL. 2026-09-01.
 *
 * Salen los dos que lo tenían. `ADMINISTRADOR_DMIP` porque la flota dejó de ser suya, y
 * **`DAF` porque el negocio lo pidió explícitamente**: «el único que podrá visualizar».
 *
 * LA SEGUNDA SALIDA TIENE CONSECUENCIA Y CONVIENE NO ENTERRARLA: hasta hoy la analista de
 * transporte podía parar un vehículo ella misma al recibir el aviso del taller. Desde
 * ahora lo registra el administrador de la flota. La regla no cambia —RN-DAF-05 sigue
 * excluyendo de la asignación al vehículo parado— y la DAF **sigue viéndolo**: el estado
 * viaja en `GET /transporte/vehiculos`, que no es de este controlador.
 *
 * ES SOLO EL CAMINO DE ESCRITURA, no el dato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
@Controller('transporte/vehiculos')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('flota:mantenimiento')
export class MantenimientoVehiculoController {
  constructor(private readonly mantenimiento: MantenimientoVehiculoService) {}

  /**
   * D4 (2026-10-20): los traslados ya asignados a la placa entre `desde` y `hasta`, para avisar
   * antes de guardar la parada. No cambia nada.
   */
  @Get(':id/mantenimiento/impacto')
  async impacto(
    @Param('id', ParseIntPipe) id: number,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ): Promise<{ tramosAfectados: TramoAfectadoPorParada[] }> {
    return {
      tramosAfectados: await this.mantenimiento.impacto(
        id,
        exigirFecha(desde),
        exigirFecha(hasta),
      ),
    };
  }

  /** RN-DAF-05. Las paradas de un vehículo, de la más reciente hacia atrás. */
  @Get(':id/mantenimiento')
  async listar(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MantenimientoResponseDto[]> {
    const filas = await this.mantenimiento.listarDe(id);
    return filas.map(aMantenimientoResponse);
  }

  @Post(':id/mantenimiento')
  async registrar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CrearMantenimientoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<MantenimientoResponseDto> {
    const registrado = await this.mantenimiento.registrar(
      id,
      {
        desde: exigirFecha(dto.desde),
        hasta: exigirFecha(dto.hasta),
        taller: dto.taller,
        hora: dto.hora,
        motivo: dto.motivo,
        zonalTallerId: dto.zonalTallerId ?? null,
      },
      usuario.usuarioId,
    );

    return aMantenimientoResponse(registrado);
  }

  /** Fase 5. Cambia el estado de la cita: PROGRAMADO → EN_TALLER → LISTO (LISTO vuelve a circular). */
  @Patch(':id/mantenimiento/:mantenimientoId/estado')
  async cambiarEstado(
    @Param('id', ParseIntPipe) _id: number,
    @Param('mantenimientoId', ParseIntPipe) mantenimientoId: number,
    @Body() dto: CambiarEstadoMantenimientoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<MantenimientoResponseDto> {
    const fila = await this.mantenimiento.cambiarEstado(
      mantenimientoId,
      dto.estado,
      usuario.usuarioId,
    );
    return aMantenimientoResponse(fila);
  }

  /**
   * Retira una parada.
   *
   * El identificador del vehículo va en la ruta aunque el servicio no lo necesite: la
   * dirección de un recurso incluye a su dueño, y así la ruta se lee sola.
   */
  @Delete(':id/mantenimiento/:mantenimientoId')
  async retirar(
    @Param('id', ParseIntPipe) _id: number,
    @Param('mantenimientoId', ParseIntPipe) mantenimientoId: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ retirado: boolean }> {
    await this.mantenimiento.retirar(mantenimientoId, usuario.usuarioId);
    return { retirado: true };
  }
}

/** Mismo criterio que en el resto del módulo: `@db.Date` se interpreta en UTC. */
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

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia
  ) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }

  return fecha;
}
