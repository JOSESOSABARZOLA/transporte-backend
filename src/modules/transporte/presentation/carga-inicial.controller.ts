/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.controller.ts
 * Responsabilidad: Exponer la vista previa y la aplicación de la carga inicial desde Excel.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * OPCIÓN OCULTA del administrador general: permiso `carga-inicial:administrar` (solo ADMINISTRADOR
 * en la semilla). Sirve para poblar conductores, vehículos, garajes y turnos la primera vez; el día
 * a día se hace en las pantallas de siempre. `exceljs` LEE el archivo por la autorización ampliada
 * el 2026-10-07 (CLAUDE.md §2).
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import {
  CargaInicialService,
  type ResultadoCarga,
} from '../application/carga-inicial.service';
import type { PreviaCarga } from '../application/politicas/carga-inicial';
import {
  AplicarCargaInicialDto,
  PreviaCargaInicialDto,
} from './dto/carga-inicial.dto';

const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** 5 MB: una carga inicial de cientos de filas pesa decenas de KB. */
const TAMANO_MAXIMO_XLSX = 5 * 1024 * 1024;

/** Lo que entrega `FileInterceptor` (multer, en memoria). */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller('administracion/carga-inicial')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('carga-inicial:administrar')
export class CargaInicialController {
  constructor(private readonly carga: CargaInicialService) {}

  /** Multipart: `archivo` (.xlsx, máx. 5 MB), `tipo` y, para turnos, `mes`. NO escribe. */
  @Post('previsualizar')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(
    FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO_XLSX } }),
  )
  async previsualizar(
    @Body() dto: PreviaCargaInicialDto,
    @UploadedFile() archivo: ArchivoSubido | undefined,
  ): Promise<PreviaCarga> {
    if (!archivo) {
      throw new ValidacionError('Adjunte el archivo de Excel (.xlsx).');
    }
    const esXlsx =
      archivo.originalname.toLowerCase().endsWith('.xlsx') &&
      (archivo.mimetype === MIME_XLSX ||
        archivo.mimetype === 'application/octet-stream');
    if (!esXlsx) {
      throw new ValidacionError(
        'El archivo debe ser un libro de Excel (.xlsx).',
      );
    }
    return this.carga.previsualizar(dto.tipo, dto.mes, archivo.buffer);
  }

  /** Aplica las filas (las revalida una por una). Upsert por cédula, placa o nombre. */
  @Post('aplicar')
  @HttpCode(HttpStatus.OK)
  async aplicar(
    @Body() dto: AplicarCargaInicialDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoCarga> {
    return this.carga.aplicar(dto.tipo, dto.mes, dto.filas, {
      usuarioId: usuario.usuarioId,
      rol: usuario.rol,
    });
  }
}
