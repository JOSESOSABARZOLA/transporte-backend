/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitudes-apoyo.controller.ts
 * Responsabilidad: Exponer el registro y la consulta de solicitudes de apoyo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * SIN PREFIJO DE CONTROLADOR, a propósito. Las rutas viven en dos sitios porque
 * responden a dos preguntas distintas:
 *
 *   · `/operativos/:id/apoyo` — qué apoyo se pidió PARA ESTE OPERATIVO. Es la pantalla
 *     de registro, que ya está viendo el operativo.
 *   · `/solicitudes-apoyo` — qué apoyo me involucra HOY. Es la bandeja, y hace falta
 *     precisamente porque la dirección requerida **no puede abrir el operativo ajeno**:
 *     PER-02 se lo impide, y sin bandeja no se enteraría nunca (caso 4 del plan).
 *
 * SIN `FormularioRolGuard`. Como en `PATCH` y `DELETE` de operativos, la ruta lleva el
 * identificador del operativo y no el código del formulario: la propiedad la comprueba
 * el servicio, con `exigirOperativoPropio`.
 */

import {
  Body,
  Controller,
  Get,
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
import type { Autor } from '../application/operativos.service';
import { SolicitudApoyoService } from '../application/solicitud-apoyo.service';
import {
  aSolicitudApoyoResponse,
  FiltroSolicitudesDto,
  SolicitarApoyoDto,
  type SolicitudApoyoResponseDto,
} from './dto/solicitud-apoyo.dto';

@Controller()
@UseGuards(IdentidadGuard, PermisosGuard, VentanaCargaGuard)
export class SolicitudesApoyoController {
  constructor(private readonly solicitudes: SolicitudApoyoService) {}

  /** CU-13. Se registra en estado `SOLICITADA` y ahí se queda (PV-12). */
  @Post('operativos/:id/apoyo')
  @RequierePermiso('operativos:apoyo:solicitar')
  async solicitar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SolicitarApoyoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SolicitudApoyoResponseDto> {
    return aSolicitudApoyoResponse(
      await this.solicitudes.solicitar(id, dto, comoAutor(usuario)),
    );
  }

  /** Lo pedido para un operativo concreto. Lo ve quien puede ver el operativo. */
  @Get('operativos/:id/apoyo')
  @RequierePermiso('operativos:apoyo:ver')
  async listarDeOperativo(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SolicitudApoyoResponseDto[]> {
    const solicitudes = await this.solicitudes.listarDeOperativo(
      id,
      comoAutor(usuario),
    );

    return solicitudes.map(aSolicitudApoyoResponse);
  }

  /**
   * Caso 4 del plan. La bandeja: lo que me piden y lo que pedí.
   *
   * La Dirección y la administración las ven todas —FASE2 §14 les da lectura—, y la DAF
   * no: el apoyo es de personal, no de transporte.
   */
  @Get('solicitudes-apoyo')
  @RequierePermiso('operativos:apoyo:bandeja')
  async consultarBandeja(
    @Query() filtro: FiltroSolicitudesDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<SolicitudApoyoResponseDto[]> {
    const solicitudes = await this.solicitudes.consultarBandeja(
      {
        fecha: filtro.fecha ? exigirFecha(filtro.fecha) : undefined,
        estado: filtro.estado,
      },
      comoAutor(usuario),
    );

    return solicitudes.map(aSolicitudApoyoResponse);
  }
}

function comoAutor(usuario: UsuarioAutenticado): Autor {
  return { usuarioId: usuario.usuarioId, rol: usuario.rol };
}

/** Mismo criterio que en M-13 y M-14: `@db.Date` se interpreta en UTC. */
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
