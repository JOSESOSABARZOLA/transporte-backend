/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administracion-formularios.controller.ts
 * Responsabilidad: Exponer el alta, la edición y la baja de formularios por pantalla.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-29
 *
 * MISMO PERMISO QUE EL RESTO DE LA ADMINISTRACIÓN DEL CUADRO (`catalogos:administrar`): quien
 * administra zonales, puntos, tipos e instituciones —y las áreas de un formulario— administra
 * también los formularios. SIN `VentanaCargaGuard` (esto es configuración, no la jornada) y sin
 * `FormularioRolGuard` (el administrador no participa en ningún formulario: los administra todos).
 *
 * Convive con `AdministracionAreasController` bajo la misma base `administracion/formularios`:
 * las rutas no chocan (`:codigo/areas` allí; aquí `GET`, `POST`, `PUT :codigo`, `DELETE :codigo`).
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import {
  FormulariosAdminService,
  type ResultadoBajaFormulario,
} from '../application/formularios-admin.service';
import {
  PALETA_FORMULARIOS,
  type ColorFormulario,
} from '../domain/paleta-formularios';
import type { FormularioCompleto } from '../infrastructure/formularios.repository';
import {
  ActualizarFormularioDto,
  CrearFormularioDto,
} from './dto/administrar-formularios.dto';

/** La definición del formulario que la pantalla de administración necesita para listar y editar. */
interface FormularioResponseDto {
  id: number;
  numero: number;
  codigo: string;
  nombre: string;
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  rolDueno: string;
  politicaVehiculo: string;
  condicionanteNoct: boolean;
  esPatrulla: boolean;
  capturaLibrePunto: boolean;
  capturaLibreTipo: boolean;
  puntoManual: boolean;
  filtraPersonalPorRol: boolean;
  tipoControlMultiple: boolean;
  variosPorPersona: boolean;
  cantidadPorPersona: boolean;
  orden: number;
  activo: boolean;
  areas: string[];
  prefijo: string;
}

/** Convierte la fila completa (con áreas y prefijos) al contrato que consume la pantalla. */
function aRespuesta(formulario: FormularioCompleto): FormularioResponseDto {
  const predeterminado =
    formulario.prefijos.find(
      (prefijo) =>
        prefijo.esPredeterminado &&
        !prefijo.esAdicional &&
        prefijo.areaAplica === null,
    ) ?? formulario.prefijos[0];

  return {
    id: formulario.id,
    numero: formulario.numero,
    codigo: formulario.codigo,
    nombre: formulario.nombre,
    colorFondo: formulario.colorFondo,
    colorAcento: formulario.colorAcento,
    colorNombre: formulario.colorNombre,
    rolDueno: formulario.rolDueno,
    politicaVehiculo: formulario.politicaVehiculo,
    condicionanteNoct: formulario.condicionanteNoct,
    esPatrulla: formulario.esPatrulla,
    capturaLibrePunto: formulario.capturaLibrePunto,
    capturaLibreTipo: formulario.capturaLibreTipo,
    puntoManual: formulario.puntoManual,
    filtraPersonalPorRol: formulario.filtraPersonalPorRol,
    tipoControlMultiple: formulario.tipoControlMultiple,
    variosPorPersona: formulario.variosPorPersona,
    cantidadPorPersona: formulario.cantidadPorPersona,
    orden: formulario.orden,
    activo: formulario.activo,
    areas: formulario.areas.map((area) => area.area),
    prefijo: predeterminado?.prefijo ?? '',
  };
}

@Controller('administracion/formularios')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('catalogos:administrar')
export class AdministracionFormulariosController {
  constructor(private readonly formularios: FormulariosAdminService) {}

  /** Todos los formularios (incluidos los dados de baja), para la tabla de administración. */
  @Get()
  async listar(): Promise<FormularioResponseDto[]> {
    const formularios = await this.formularios.listarTodos();
    return formularios.map(aRespuesta);
  }

  /** La paleta institucional de colores, para que la pantalla ofrezca las muestras a elegir. */
  @Get('paleta')
  obtenerPaleta(): readonly ColorFormulario[] {
    return PALETA_FORMULARIOS;
  }

  @Post()
  async crear(
    @Body() dto: CrearFormularioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FormularioResponseDto> {
    const formulario = await this.formularios.crear(dto, usuario.usuarioId);
    return aRespuesta(formulario);
  }

  @Put(':codigo')
  async actualizar(
    @Param('codigo') codigo: string,
    @Body() dto: ActualizarFormularioDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<FormularioResponseDto> {
    const formulario = await this.formularios.actualizar(
      codigo,
      dto,
      usuario.usuarioId,
    );
    return aRespuesta(formulario);
  }

  @Delete(':codigo')
  async darDeBaja(
    @Param('codigo') codigo: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ResultadoBajaFormulario> {
    return this.formularios.darDeBaja(codigo, usuario.usuarioId);
  }
}
