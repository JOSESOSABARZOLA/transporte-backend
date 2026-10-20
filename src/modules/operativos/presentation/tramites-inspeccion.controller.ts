/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos · Trámites de Inspección
 * Archivo: tramites-inspeccion.controller.ts
 * Responsabilidad: Exponer los trámites de Inspección de las personas que se están asignando.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * `GET /api/v1/inspeccion/tramites?fecha=AAAA-MM-DD&funcionarioId=…`
 *
 * Es una LECTURA de apoyo al registro: no declara `VentanaCargaGuard`, porque consultar no escribe
 * nada en el cuadro. Lo exige el permiso de registrar operativos, que es quien elige el trámite.
 *
 * La respuesta nunca es un 5xx por culpa de Inspección: si no responde, viaja `disponible: false`
 * con el motivo y la pantalla lo dice. La CÉDULA no sale de aquí: el cruce se hace en el servidor.
 * Viaja la UNIÓN de los roles: el servicio recorta a las personas que esos roles pueden asignar.
 */

import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { RequierePermiso } from '../../../common/auth/decorators/requiere-permiso.decorator';
import { UsuarioActual } from '../../../common/auth/decorators/usuario-actual.decorator';
import { IdentidadGuard } from '../../../common/auth/guards/identidad.guard';
import { PermisosGuard } from '../../../common/auth/guards/permisos.guard';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';
import { TramitesInspeccionService } from '../application/tramites-inspeccion.service';
import {
  ConsultarTramitesDto,
  type ConsultaTramitesResponseDto,
} from './dto/tramites-inspeccion.dto';

@Controller('inspeccion')
@UseGuards(IdentidadGuard, PermisosGuard)
export class TramitesInspeccionController {
  constructor(private readonly tramites: TramitesInspeccionService) {}

  @Get('tramites')
  @RequierePermiso('operativos:registrar')
  async consultar(
    @Query() consulta: ConsultarTramitesDto,
    @UsuarioActual() usuario: UsuarioAutenticado,
  ): Promise<ConsultaTramitesResponseDto> {
    return this.tramites.consultar(
      consulta.fecha,
      consulta.funcionarioId,
      usuario.tokenAuth,
      usuario.roles,
    );
  }
}
