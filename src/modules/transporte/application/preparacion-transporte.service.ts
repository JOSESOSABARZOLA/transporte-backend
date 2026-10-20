/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · planificar el día
 * Archivo: preparacion-transporte.service.ts
 * Responsabilidad: Reunir los datos de la lista «Antes de asignar» de una fecha.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Solo LEE: cuadro, conductores activos y turnos de la fecha. La decisión vive en la política
 * pura `politicas/preparacion-dia.ts`.
 */

import { Injectable } from '@nestjs/common';

import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { prepararDia, type Preparacion } from './politicas/preparacion-dia';
import { mesDe } from './politicas/publicacion-turnos';

@Injectable()
export class PreparacionTransporteService {
  constructor(
    private readonly repositorio: PlanificacionTransporteRepository,
  ) {}

  async preparar(fecha: Date): Promise<Preparacion> {
    const [cuadro, conductores, turnos, estadoMes] = await Promise.all([
      this.repositorio.cuadroDeFecha(fecha),
      this.repositorio.conductoresActivos(),
      this.repositorio.turnosEnRango(fecha, fecha),
      this.repositorio.estadoMes(mesDe(fecha)),
    ]);

    return prepararDia({
      fecha,
      cuadro,
      conductores,
      conductoresConTurno: new Set(turnos.map((t) => t.conductorId)),
      estadoMes,
    });
  }
}
