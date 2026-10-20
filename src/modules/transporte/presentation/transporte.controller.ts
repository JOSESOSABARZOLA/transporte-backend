/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.controller.ts
 * Responsabilidad: Exponer la asignación logística de la DAF.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * PRIMER NIVEL DE LA RESTRICCIÓN DE LA DAF: **endpoints propios**.
 *
 * La asignación no es un `PATCH` más sobre `/operativos/:id` con un rol distinto: vive
 * bajo `/transporte`, con `@Roles(DAF)`. Compartir la ruta con la edición departamental
 * dejaría que un solo descuido en el DTO o en la guarda abriera todo el operativo a un
 * rol que solo debe escribir dos campos.
 *
 * La consulta de pendientes la comparte con el `DIRECTOR`, que revisa lo que falta antes
 * de cerrar la jornada. Escribir, solo la DAF.
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Put,
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
import { DestinoVehiculoService } from '../application/destino-vehiculo.service';
import {
  JornadaConductoresService,
  type JornadaDeConductor,
} from '../application/jornada-conductores.service';
import { TransporteService } from '../application/transporte.service';
import {
  ActualizarTransporteDto,
  aDestinoResponse,
  aPendienteResponse,
  aTransporteResponse,
  type ConductorDisponibleDto,
  DeclararDestinoDto,
  type DestinoResponseDto,
  type PendienteResponseDto,
  type TransporteResponseDto,
  type VehiculoDeLaFlotaDto,
} from './dto/transporte.dto';

@Controller('transporte')
@UseGuards(IdentidadGuard, PermisosGuard, VentanaCargaGuard)
export class TransporteController {
  constructor(
    private readonly transporte: TransporteService,
    private readonly destino: DestinoVehiculoService,
    private readonly jornada: JornadaConductoresService,
  ) {}

  /**
   * Lo que la DAF tiene por resolver ese día. Los nocturnos primero.
   *
   * Con `?incluirResueltos=true` llegan también los ya asignados y los de propios medios,
   * que es la vista desde la que se corrige. Va como parámetro y no como endpoint aparte
   * porque es **la misma bandeja con más filas**: duplicar la ruta obligaría a mantener
   * dos veces el orden, el filtro por política de vehículo y el mapeo de respuesta.
   */
  @Get('pendientes/:fecha')
  @RequierePermiso('transporte:pendientes:ver')
  async pendientes(
    @Param('fecha') fecha: string,
    @Query('incluirResueltos') incluirResueltos?: string,
  ): Promise<PendienteResponseDto[]> {
    const operativos = await this.transporte.consultarPendientes(
      exigirFecha(fecha),
      incluirResueltos === 'true',
    );

    return operativos.map(aPendienteResponse);
  }

  /**
   * PV-33. La flota completa del día, con el motivo de la que no se puede usar.
   *
   * Lo consulta también el `DIRECTOR`, por el mismo criterio que los pendientes: revisa
   * lo que falta antes de cerrar la jornada, y saber que tres placas están en el taller
   * es parte de eso.
   *
   * Y `ADMINISTRADOR_DAF` DESDE EL 2026-09-01: es de aquí de donde la pantalla de
   * mantenimiento saca la lista de vehículos sobre la que se elige cuál parar. Sin esta
   * línea la pantalla se le abría vacía, sin decir por qué — lo dio la comprobación
   * contra el servidor, no las pruebas: es un cruce entre dos controladores.
   */
  @Get('vehiculos')
  @RequierePermiso('transporte:vehiculos:ver')
  async vehiculos(
    @Query('fecha') fecha: string,
  ): Promise<VehiculoDeLaFlotaDto[]> {
    return this.transporte.vehiculosDeLaFlota(exigirFecha(fecha));
  }

  /**
   * RN-45. El desplegable llega **ya filtrado** desde el servidor.
   *
   * Cada conductor viaja con su vehículo habitual: es de ahí de donde la pantalla
   * propone la placa (caso 9 del plan).
   */
  @Get('conductores')
  @RequierePermiso('transporte:conductores:ver')
  async conductoresDisponibles(
    @Query('fecha') fecha: string,
  ): Promise<ConductorDisponibleDto[]> {
    return this.transporte.conductoresDisponibles(exigirFecha(fecha));
  }

  /**
   * P-14. La jornada de cada conductor del dia, con lo que ya lleva encadenado.
   *
   * Es una VISTA: no asigna nada. La asignacion sigue siendo un acto explicito por
   * PATCH /transporte/operativos/:id, con todas sus reglas.
   */
  @Get('jornada-conductores/:fecha')
  @RequierePermiso('transporte:jornada:ver')
  async jornadaConductores(
    @Param('fecha') fecha: string,
  ): Promise<JornadaDeConductor[]> {
    return this.jornada.componer(exigirFecha(fecha));
  }

  /** RN-DAF-03. Lo declarado para esa fecha, con placa y zonal resueltas. */
  @Get('destinos/:fecha')
  @RequierePermiso('transporte:destinos:ver')
  async destinos(@Param('fecha') fecha: string): Promise<DestinoResponseDto[]> {
    const filas = await this.destino.consultarDeLaFecha(exigirFecha(fecha));
    return filas.map(aDestinoResponse);
  }

  /**
   * RN-DAF-03. Dónde queda el vehículo al terminar la jornada.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ES UN ENDPOINT APARTE, Y NO UN CAMPO MÁS EN `PATCH /transporte/operativos/:id`.
   *
   * El destino lo escribe la DAF, así que la tentación es sumarlo al contrato de la
   * asignación. La regla 3 de CLAUDE.md lo prohíbe —ese DTO tiene exactamente dos
   * propiedades— y su propio comentario dice qué hacer en su lugar: darle su propio
   * endpoint con su propio contrato. Es esto.
   *
   * Y encaja mejor con el modelo: el destino **no es del operativo**, es del vehículo y
   * del día. Un conductor encadena varios operativos en un turno y el vehículo termina
   * en un solo sitio.
   * ═══════════════════════════════════════════════════════════════════════════
   *
   * `PUT` y no `POST`: declarar dos veces deja el mismo resultado, y corregir es volver
   * a declarar.
   */
  @Put('vehiculos/:id/destino/:fecha')
  @RequierePermiso('transporte:destino:fijar')
  async declararDestino(
    @Param('id', ParseIntPipe) id: number,
    @Param('fecha') fecha: string,
    @Body() dto: DeclararDestinoDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ declarado: boolean }> {
    await this.destino.declarar(
      id,
      exigirFecha(fecha),
      {
        ubicacionId: dto.ubicacionId ?? null,
        domicilio: dto.domicilio ?? false,
        observacion: dto.observacion,
        tipo: dto.tipo,
        conductorId: dto.conductorId,
      },
      usuario.usuarioId,
    );

    return { declarado: true };
  }

  /** RN-40. Los dos únicos campos que la DAF escribe. */
  @Patch('operativos/:id')
  @RequierePermiso('transporte:asignar')
  async asignar(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ActualizarTransporteDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransporteResponseDto> {
    const resultado = await this.transporte.asignar(
      id,
      dto,
      comoAutor(usuario),
    );

    return aTransporteResponse(
      resultado.operativo,
      resultado.conductor,
      resultado.vehiculo,
    );
  }

  /**
   * RN-41. El operativo se cubre por propios medios.
   *
   * **Sin cuerpo**: no hay nada que enviar. La decisión es el propio acto, y un cuerpo
   * vacío es una superficie menos que vigilar.
   */
  @Patch('operativos/:id/propios-medios')
  @RequierePermiso('transporte:propios-medios')
  async declararPropiosMedios(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransporteResponseDto> {
    const resultado = await this.transporte.declararPropiosMedios(
      id,
      comoAutor(usuario),
    );

    return aTransporteResponse(resultado.operativo, null, null);
  }

  /**
   * Devuelve el operativo a `PENDIENTE`. P-07 del análisis del 2026-08-28.
   *
   * **Sin cuerpo**, igual que propios medios: no hay nada que enviar, y un cuerpo vacío
   * es una superficie menos que vigilar.
   */
  @Patch('operativos/:id/desasignar')
  @RequierePermiso('transporte:desasignar')
  async desasignar(
    @Param('id', ParseIntPipe) id: number,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<TransporteResponseDto> {
    const resultado = await this.transporte.desasignar(id, comoAutor(usuario));

    return aTransporteResponse(resultado.operativo, null, null);
  }
}

function comoAutor(usuario: UsuarioAutenticado): Autor {
  return { usuarioId: usuario.usuarioId, rol: usuario.rol };
}

/** Mismo criterio que en M-13, M-14 y M-16: `@db.Date` se interpreta en UTC. */
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
