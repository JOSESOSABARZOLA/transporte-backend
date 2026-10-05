/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz.controller.ts
 * Responsabilidad: Exponer la matriz del día y su exportación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SOLO EL `DIRECTOR`. RN-48 y PER-02.
 *
 * **Es el requisito que originó el encargo.** El cuadro completo circulaba por WhatsApp y
 * los intervenidos se anticipaban al operativo. Cada departamento ve lo suyo en P-02; la
 * vista consolidada no se sirve a perfiles departamentales, y tampoco a la DAF —que ve
 * los nueve formularios, pero solo para asignar transporte—.
 *
 * Un solo rol en el decorador, y ningún «por si acaso» adicional: la lista corta es la que
 * se revisa de un vistazo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN `VentanaCargaGuard`. La matriz es una consulta, y la Dirección tiene que poder
 * revisarla a cualquier hora: precisamente la revisa **cuando las ventanas ya vencieron**.
 */

import {
  Controller,
  Get,
  Header,
  Param,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import { MatrizConsolidadaService } from '../application/matriz-consolidada.service';
import { aMatrizResponse, type MatrizResponseDto } from './dto/matriz.dto';

@Controller('matriz')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('matriz:ver')
export class MatrizController {
  constructor(private readonly matriz: MatrizConsolidadaService) {}

  /** La matriz del día, con los nueve formularios y sus colores. */
  @Get(':fecha')
  async consultar(@Param('fecha') fecha: string): Promise<MatrizResponseDto> {
    return aMatrizResponse(await this.matriz.componer(exigirFecha(fecha)));
  }

  /**
   * RN-47. El documento formal, para archivar y firmar.
   *
   * Se responde como descarga con nombre propio: abrir el PDF en una pestaña dejaría al
   * navegador decidir el nombre del archivo, y el documento se archiva por su fecha.
   */
  @Get(':fecha/exportar')
  @Header('Content-Type', 'application/pdf')
  async exportar(
    @Param('fecha') fecha: string,
    @Res({ passthrough: true }) respuesta: Response,
  ): Promise<StreamableFile> {
    const documento = await this.matriz.exportar(exigirFecha(fecha));

    respuesta.setHeader(
      'Content-Disposition',
      `attachment; filename="${documento.nombre}"`,
    );

    return new StreamableFile(documento.contenido);
  }
}

/** Mismo criterio que en M-13, M-14, M-16, M-17 y M-18: `@db.Date` se lee en UTC. */
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
