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
 *
 * FLOTA Y GARAJES (2026-10-14): indicadores (`GET flota/resumen`), aviso previo a la baja
 * (`GET …/:id/impacto-baja`), reactivar (`PATCH …/:id/reactivar`) y baja del garaje
 * (`DELETE ubicaciones-flota/:id`). Contrato: `docs/CONTRATO-flota-y-garajes.md`.
 *
 * MANTENIMIENTO EN LA PESTAÑA VEHÍCULOS (2026-10-20): `GET flota/vehiculos/disponibilidad?fecha=`
 * devuelve la disponibilidad de cada vehículo en la fecha y sus paradas de la semana (D3), con el
 * permiso de la pantalla (`flota:administrar`) y no con `transporte:vehiculos:ver`, que el
 * administrador general no tiene. Las bajas guardan fecha y autor y dan el motivo real (D1, D2).
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
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { fechaIsoEnZona } from '../../../common/utilidades/marca-tiempo';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { FlotaService, type ImpactoBaja } from '../application/flota.service';
import type { ResumenFlota } from '../application/politicas/datos-flota';
import type { DisponibilidadDeVehiculo } from '../application/politicas/semana-mantenimiento';
import { ParametrosTransporteService } from '../application/parametros-transporte.service';
import {
  ActualizarConductorDto,
  ActualizarVehiculoDto,
  aConductorResponse,
  aUbicacionResponse,
  ActualizarUbicacionDto,
  aFechaFlota,
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
  /** Conductores activos que quedaron sin vehículo habitual (baja de un vehículo; si no, vacío). */
  conductoresSinVehiculo: { id: number; nombreCompleto: string }[];
}

/** Los indicadores de la pantalla y la anticipación del aviso de documentos. */
interface ResumenFlotaResponseDto extends ResumenFlota {
  /** DAF_DIAS_AVISO_VENCIMIENTO: «vence en ≤ N días». */
  diasAviso: number;
  /** DAF_KM_MAXIMO: tope del kilometraje (A2), para avisar en el formulario antes de guardar. */
  kmMaximo: number;
}

/** La disponibilidad de la flota en una fecha y las paradas de su semana (D3, 2026-10-20). */
interface DisponibilidadFlotaResponseDto {
  /** La fecha elegida (AAAA-MM-DD). */
  fecha: string;
  /** El último día de la semana (fecha + 6). */
  hasta: string;
  vehiculos: DisponibilidadDeVehiculo[];
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
  constructor(
    private readonly flota: FlotaService,
    private readonly parametros: ParametrosTransporteService,
  ) {}

  // ─────────────────────────── Indicadores ───────────────────────────

  @Get('flota/resumen')
  async resumen(): Promise<ResumenFlotaResponseDto> {
    const [diasAviso, kmMaximo] = await Promise.all([
      this.parametros.leerDiasAvisoVencimiento(),
      this.parametros.leerKmMaximo(),
    ]);
    return { ...(await this.flota.resumen(diasAviso)), diasAviso, kmMaximo };
  }

  /** D3: sin `fecha`, hoy en Quito. Dos consultas para toda la flota. */
  @Get('flota/vehiculos/disponibilidad')
  async disponibilidad(
    @Query('fecha') fecha?: string,
  ): Promise<DisponibilidadFlotaResponseDto> {
    return this.flota.disponibilidad(fechaValida(fecha ?? fechaIsoEnZona()));
  }

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
    const conductor = await this.flota.crearConductor(
      conFechasDeConductor(dto),
      usuario.usuarioId,
    );

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
      conFechasDeConductor(dto),
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
      conductoresSinVehiculo: baja.conductoresSinVehiculo,
    };
  }

  @Get('conductores/:id/impacto-baja')
  async impactoBajaConductor(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImpactoBaja> {
    return this.flota.impactoBajaConductor(id);
  }

  @Patch('conductores/:id/reactivar')
  async reactivarConductor(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ id: number; nombreCompleto: string; activo: boolean }> {
    const conductor = await this.flota.reactivarConductor(
      id,
      usuario.usuarioId,
    );
    return {
      id: conductor.id,
      nombreCompleto: conductor.nombreCompleto,
      activo: conductor.activo,
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

    const dias = await this.parametros.leerDiasAvisoVencimiento();
    return vehiculos.map((v) => aVehiculoResponse(v, dias));
  }

  @Post('vehiculos')
  async crearVehiculo(
    @Body() dto: CrearVehiculoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VehiculoResponseDto> {
    return aVehiculoResponse(
      await this.flota.crearVehiculo(
        conFechasDeVehiculo(dto),
        usuario.usuarioId,
      ),
      await this.parametros.leerDiasAvisoVencimiento(),
    );
  }

  @Patch('vehiculos/:id')
  async actualizarVehiculo(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarVehiculoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VehiculoResponseDto> {
    return aVehiculoResponse(
      await this.flota.actualizarVehiculo(
        id,
        conFechasDeVehiculo(dto),
        usuario.usuarioId,
      ),
      await this.parametros.leerDiasAvisoVencimiento(),
    );
  }

  @Delete('vehiculos/:id')
  async desactivarVehiculo(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<BajaResponseDto<VehiculoResponseDto>> {
    const baja = await this.flota.desactivarVehiculo(id, usuario.usuarioId);

    return {
      registro: aVehiculoResponse(
        baja.registro,
        await this.parametros.leerDiasAvisoVencimiento(),
      ),
      operativosHistoricos: baja.operativosHistoricos,
      mensaje: baja.mensaje,
      conductoresSinVehiculo: baja.conductoresSinVehiculo,
    };
  }

  @Get('vehiculos/:id/impacto-baja')
  async impactoBajaVehiculo(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ImpactoBaja> {
    return this.flota.impactoBajaVehiculo(id);
  }

  @Patch('vehiculos/:id/reactivar')
  async reactivarVehiculo(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VehiculoResponseDto> {
    return aVehiculoResponse(
      await this.flota.reactivarVehiculo(id, usuario.usuarioId),
      await this.parametros.leerDiasAvisoVencimiento(),
    );
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
    const usos = await this.flota.usosDeUbicaciones();
    return filas.map((u) => aUbicacionResponse(u, usos.get(u.id)));
  }

  @Post('ubicaciones-flota')
  async crearUbicacion(
    @Body() dto: CrearUbicacionDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UbicacionResponseDto> {
    return aUbicacionResponse(
      await this.flota.crearUbicacion(dto.nombre, usuario.usuarioId, {
        zonalId: dto.zonalId,
      }),
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
    return this.conUsos(
      await this.flota.actualizarUbicacion(id, dto, usuario.usuarioId),
    );
  }

  /** Baja del garaje (D2): deja de estar activo y autorizado. Lo ya declarado se conserva. */
  @Delete('ubicaciones-flota/:id')
  async darDeBajaUbicacion(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UbicacionResponseDto> {
    return this.conUsos(
      await this.flota.darDeBajaUbicacion(id, usuario.usuarioId),
    );
  }

  @Patch('ubicaciones-flota/:id/reactivar')
  async reactivarUbicacion(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<UbicacionResponseDto> {
    return this.conUsos(
      await this.flota.reactivarUbicacion(id, usuario.usuarioId),
    );
  }

  private async conUsos(
    ubicacion: Parameters<typeof aUbicacionResponse>[0],
  ): Promise<UbicacionResponseDto> {
    const usos = await this.flota.usosDeUbicaciones([ubicacion.id]);
    return aUbicacionResponse(ubicacion, usos.get(ubicacion.id));
  }
}

/** AAAA-MM-DD que exista en el calendario; si no, 400 con la frase para el usuario. */
function fechaValida(texto: string): string {
  const partes = /^(d{4})-(d{2})-(d{2})$/.exec(texto);
  const fecha = partes ? new Date(`${texto}T00:00:00.000Z`) : null;
  if (
    !fecha ||
    Number.isNaN(fecha.getTime()) ||
    fecha.toISOString().slice(0, 10) !== texto
  ) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { fecha: texto },
    );
  }
  return texto;
}

/**
 * Las fechas de la ficha viajan como AAAA-MM-DD; el servicio las recibe como Date. Solo se
 * devuelven las que vinieron: una clave `undefined` pisaría el valor actual en la traza.
 */
function soloPresentes(fechas: Record<string, string | null | undefined>) {
  return Object.fromEntries(
    Object.entries(fechas)
      .filter(([, valor]) => valor !== undefined)
      .map(([campo, valor]) => [campo, aFechaFlota(valor)]),
  ) as Record<string, Date | null>;
}

function conFechasDeConductor<
  T extends {
    actaParqueaderoDesde?: string | null;
    actaParqueaderoHasta?: string | null;
  },
>(dto: T) {
  const { actaParqueaderoDesde, actaParqueaderoHasta, ...resto } = dto;
  return {
    ...resto,
    ...(soloPresentes({ actaParqueaderoDesde, actaParqueaderoHasta }) as {
      actaParqueaderoDesde?: Date | null;
      actaParqueaderoHasta?: Date | null;
    }),
  };
}

function conFechasDeVehiculo<
  T extends {
    matriculaVencimiento?: string | null;
    soatVencimiento?: string | null;
  },
>(dto: T) {
  const { matriculaVencimiento, soatVencimiento, ...resto } = dto;
  return {
    ...resto,
    ...(soloPresentes({ matriculaVencimiento, soatVencimiento }) as {
      matriculaVencimiento?: Date | null;
      soatVencimiento?: Date | null;
    }),
  };
}
