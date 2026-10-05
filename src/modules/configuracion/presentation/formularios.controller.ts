/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios.controller.ts
 * Responsabilidad: Exponer la definición de los formularios y sus catálogos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * SIN `FormularioRolGuard`, Y ES DELIBERADO. Esa guarda protege la ESCRITURA sobre un
 * formulario ajeno. Aquí no se escribe nada: se consultan las opciones que el
 * formulario ofrece —zonales, puntos, tipos de control e instituciones—, que son
 * catálogo institucional y no información operativa. El aislamiento que originó el
 * encargo protege quién sale, a qué hora y a qué punto; no la lista de puntos
 * existentes. Así lo fija el plan: «Lectura para todos los roles autenticados».
 *
 * `GET /formularios/permitidos` SÍ filtra por rol, porque ahí la pregunta es otra:
 * qué puede registrar quien consulta.
 */

import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';

import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { CatalogosService } from '../application/catalogos.service';
import { FormulariosService } from '../application/formularios.service';
import {
  aCatalogosResponse,
  aPuntoResponse,
  type CatalogosFormularioResponseDto,
  type PuntoResponseDto,
} from './dto/catalogos-response.dto';
import {
  aFormularioResponse,
  type FormularioResponseDto,
} from './dto/formulario-response.dto';

@Controller('formularios')
@UseGuards(IdentidadGuard, PermisosGuard)
export class FormulariosController {
  constructor(
    private readonly formularios: FormulariosService,
    private readonly catalogos: CatalogosService,
  ) {}

  /** PER-01. Devuelve solo los formularios del rol que consulta. */
  @Get('permitidos')
  async permitidos(
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FormularioResponseDto[]> {
    const permitidos = await this.formularios.obtenerPermitidos(usuario.roles);
    return permitidos.map(aFormularioResponse);
  }

  /** RN-16. Los catálogos propios del formulario, más las zonales completas. */
  @Get(':codigo/catalogos')
  async catalogosDe(
    @Param('codigo') codigo: string,
  ): Promise<CatalogosFormularioResponseDto> {
    return aCatalogosResponse(await this.catalogos.obtenerCatalogos(codigo));
  }

  /** RN-17. El punto de encuentro depende de la zonal, dentro del formulario. */
  @Get(':codigo/zonales/:zonalId/puntos')
  async puntosDe(
    @Param('codigo') codigo: string,
    @Param('zonalId', ParseIntPipe) zonalId: number,
  ): Promise<PuntoResponseDto[]> {
    const puntos = await this.catalogos.obtenerPuntos(codigo, zonalId);
    return puntos.map(aPuntoResponse);
  }
}
