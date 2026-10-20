/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores.controller.ts
 * Responsabilidad: Exponer la matriz mensual de turnos de conductores y la de traslados.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Son pantallas de ADMINISTRACIÓN DE LA FLOTA: permiso `flota:administrar` (DAF, ADMINISTRADOR_DAF
 * y ADMINISTRADOR), igual que conductores, vehículos y mantenimiento. Sin `VentanaCargaGuard`, como
 * `AdministracionFlotaController`: planificar el mes no es cargar el cuadro del día.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { Autor } from '../../operativos/application/operativos.service';
import type { PreviaImportacion } from '../application/politicas/importar-horario';
import type { ResultadoPropuestaMes } from '../application/politicas/propuesta-turnos.policy';
import { TrasladosService } from '../application/traslados.service';
import {
  TurnosConductoresService,
  type MatrizTurnosConductores,
  type ResultadoLoteConductores,
} from '../application/turnos-conductores.service';
import {
  CeldaTurnoConductorDto,
  ExportarTurnosDto,
  GuardarTrasladosDto,
  LoteTurnosConductoresDto,
  MesTurnosDto,
  PropuestaMesConductoresDto,
  PropuestaRotacionConductoresDto,
} from './dto/planificacion.dto';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 2 MB: un HORARIO de un mes pesa decenas de KB; el límite corta archivos que no lo son. */
const TAMANO_MAXIMO_XLSX = 2 * 1024 * 1024;

/** Lo que entrega `FileInterceptor` (multer, en memoria). Sin depender de `@types/multer`. */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller()
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('flota:administrar')
export class TurnosConductoresController {
  constructor(
    private readonly turnos: TurnosConductoresService,
    private readonly traslados: TrasladosService,
  ) {}

  // ─────────────────────────── Turnos de conductores ───────────────────────────

  @Get('transporte/turnos-conductores')
  async matriz(@Query() dto: MesTurnosDto): Promise<MatrizTurnosConductores> {
    return this.turnos.matriz(dto.mes);
  }

  /** Una celda; `turno: null` la limpia. 400 si ese día hay una ausencia. */
  @Put('transporte/turnos-conductores')
  @HttpCode(HttpStatus.NO_CONTENT)
  async editarCelda(
    @Body() dto: CeldaTurnoConductorDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<void> {
    await this.turnos.editarCelda(
      dto.conductorId,
      dto.fecha,
      dto.turno,
      comoAutor(usuario),
    );
  }

  @Put('transporte/turnos-conductores/lote')
  async editarLote(
    @Body() dto: LoteTurnosConductoresDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoLoteConductores> {
    return this.turnos.editarLote(dto.celdas, comoAutor(usuario));
  }

  @Post('transporte/turnos-conductores/propuesta-rotacion')
  @HttpCode(HttpStatus.OK)
  async propuesta(@Body() dto: PropuestaRotacionConductoresDto) {
    return this.turnos.proponerRotacion(dto.mes, dto.conductorIds);
  }

  /** «Proponer el mes» (2026-10-07): propuestas + resumen. NO escribe; se aplica con el lote. */
  @Post('transporte/turnos-conductores/propuesta-mes')
  @HttpCode(HttpStatus.OK)
  async propuestaMes(
    @Body() dto: PropuestaMesConductoresDto,
  ): Promise<ResultadoPropuestaMes> {
    return this.turnos.proponerMes(dto.mes, dto.rehacerTodo ?? false);
  }

  @Post('transporte/turnos-conductores/publicar')
  @HttpCode(HttpStatus.OK)
  async publicar(
    @Body() dto: MesTurnosDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ) {
    return this.turnos.publicarMes(dto.mes, comoAutor(usuario));
  }

  @Get('transporte/turnos-conductores/exportar')
  async exportar(
    @Query() dto: ExportarTurnosDto,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    // Solo un mes publicado (409 «Publique el mes antes de exportar el reporte»).
    const formato = dto.formato ?? 'xlsx';
    const contenido = await this.turnos.exportar(dto.mes, formato);
    respuesta.setHeader(
      'Content-Type',
      formato === 'pdf' ? 'application/pdf' : MIME_XLSX,
    );
    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="turnos-conductores-${dto.mes}.${formato}"`,
    );
    return new StreamableFile(contenido);
  }

  /**
   * VISTA PREVIA de la importación del HORARIO de la DAF (.xlsx, 2026-10-06). Desde el 2026-10-07
   * la pantalla de turnos ya no la ofrece: la usa solo la CARGA INICIAL (administrador). Multipart: campo
   * `archivo` (máx. 2 MB) y `mes` (AAAA-MM). NO escribe: el frontend aplica las celdas válidas con
   * el lote. Se valida extensión y tipo: solo libros de Excel.
   */
  @Post('transporte/turnos-conductores/importar/previsualizar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_XLSX } }),
  )
  async previsualizarImportacion(
    @Body() dto: MesTurnosDto,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ): Promise<PreviaImportacion> {
    if (!archivo) {
      throw new ValidacionError('Adjunte el archivo HORARIO (.xlsx).');
    }
    const esXlsx =
      archivo.originalname.toLowerCase().endsWith('.xlsx') &&
      (archivo.mimetype === MIME_XLSX ||
        archivo.mimetype === 'application/octet-stream');
    if (!esXlsx) {
      throw new ValidacionError(
        'El archivo debe ser un libro de Excel (.xlsx) con el formato HORARIO de la DAF.',
      );
    }
    return this.turnos.previsualizarImportacion(dto.mes, archivo.buffer);
  }

  // ─────────────────────────── Traslados entre zonales ───────────────────────────

  @Get('administracion/traslados')
  async matrizTraslados() {
    return this.traslados.matriz();
  }

  /** Fija pares (minutos) o los borra (`minutos: null`) para volver a la regla general. */
  @Put('administracion/traslados')
  async guardarTraslados(
    @Body() dto: GuardarTrasladosDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<{ guardados: number }> {
    return this.traslados.guardar(dto.pares, comoAutor(usuario));
  }
}

function comoAutor(usuario: UsuarioAutenticado): Autor {
  return { usuarioId: usuario.usuarioId, rol: usuario.rol };
}
