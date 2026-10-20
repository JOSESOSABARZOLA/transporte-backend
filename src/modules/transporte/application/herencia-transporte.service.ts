/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos adicionales · herencia del transporte del original
 * Archivo: herencia-transporte.service.ts
 * Responsabilidad: Implementar el puerto `HerenciaTransporte` de `operativos` e inscribirse en su
 *                  registro al iniciar el módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA INVERSIÓN DE DEPENDENCIA, DEL LADO DE TRANSPORTE. `operativos` no puede importar este
 * submódulo (el ciclo lo cerraría); define el puerto y un registro, y este servicio se inscribe
 * en `onModuleInit`. La lógica —crear los tramos ya asignados y validarlos con las reglas de la
 * DAF— vive en `PlanificacionTransporteService.heredarDeOriginal`, junto a `asignarBloque`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  RegistroHerenciaTransporte,
  type HerenciaTransporte,
  type ResultadoHerencia,
} from '../../operativos/application/herencia-transporte.puerto';
import type { Autor } from '../../operativos/application/operativos.service';
import { PlanificacionTransporteService } from './planificacion-transporte.service';

@Injectable()
export class HerenciaTransporteService
  implements HerenciaTransporte, OnModuleInit
{
  constructor(
    private readonly registro: RegistroHerenciaTransporte,
    private readonly planificacion: PlanificacionTransporteService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(this);
  }

  heredar(
    datos: { padreId: number; adicionalId: number },
    autor: Autor,
  ): Promise<ResultadoHerencia> {
    return this.planificacion.heredarDeOriginal(datos, autor);
  }
}
