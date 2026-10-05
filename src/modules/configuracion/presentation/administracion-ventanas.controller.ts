/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: administracion-ventanas.controller.ts
 * Responsabilidad: Exponer la administración de las seis ventanas de carga.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * NO HAY `POST` NI `DELETE`, y no es un olvido. Hay exactamente una ventana por rol
 * —`uq_ventana_rol`— y los roles del cuadro son seis, fijos. Crear una séptima no
 * significa nada, y borrar una tendría un efecto que nadie esperaría: el evaluador
 * trata la ausencia de ventana como «sin restricción horaria», de modo que un `DELETE`
 * ABRIRÍA la carga de ese rol las veinticuatro horas. Para eso está `activo: false`,
 * que dice lo mismo de forma explícita y deja rastro en la auditoría.
 *
 * SIN `VentanaCargaGuard`, por el mismo motivo que en M-06: aplicar la ventana a la
 * pantalla que configura las ventanas crea un cepo del que no se sale desde la
 * aplicación.
 */

import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { VentanaCargaService } from '../application/ventana-carga.service';
import {
  ActualizarVentanaDto,
  aRolDepartamental,
  aVentanaResponse,
  type VentanaResponseDto,
} from './dto/ventana.dto';

/** Respuesta de la modificación: qué quedó guardado y qué conviene revisar. */
interface VentanaActualizadaResponseDto {
  ventana: VentanaResponseDto;
  advertencias: string[];
}

@Controller('administracion/ventanas')
@UseGuards(IdentidadGuard, PermisosGuard)
@RequierePermiso('ventanas:administrar')
export class AdministracionVentanasController {
  constructor(private readonly ventanas: VentanaCargaService) {}

  @Get()
  async listar(): Promise<VentanaResponseDto[]> {
    const ventanas = await this.ventanas.listar();
    return ventanas.map(aVentanaResponse);
  }

  @Get(':rol')
  async obtener(@Param('rol') rol: string): Promise<VentanaResponseDto> {
    return aVentanaResponse(
      await this.ventanas.obtener(aRolDepartamental(rol)),
    );
  }

  @Put(':rol')
  async actualizar(
    @Param('rol') rol: string,
    @Body() dto: ActualizarVentanaDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<VentanaActualizadaResponseDto> {
    const resultado = await this.ventanas.actualizar(
      aRolDepartamental(rol),
      dto,
      usuario.usuarioId,
    );

    return {
      ventana: aVentanaResponse(resultado.ventana),
      advertencias: resultado.advertencias,
    };
  }
}
