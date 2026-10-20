/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · versión consolidada
 * Archivo: nombre-unidad.ts
 * Responsabilidad: Nombrar en palabras la unidad (departamento) que cargó un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * La planificación, la tabla de la jornada y la hoja de ruta mostraban el código del rol
 * (`DMIP_OPERATIVOS`). El nombre sale de la MISMA fuente que la matriz y la orden de servicio
 * (`NOMBRE_ROL`), para que una unidad se llame igual en todo el sistema; el código sigue viajando
 * aparte (`departamentoCodigo`). Es pura.
 */

import type { RolDepartamental } from '@prisma/client';

import { NOMBRE_ROL } from '../../../../common/roles/catalogo-roles';

/** Código de rol → nombre legible. Un código desconocido se devuelve tal cual; `null` sigue `null`. */
export function nombreDeUnidad(rol: string | null | undefined): string | null {
  if (!rol) return null;
  return NOMBRE_ROL[rol as RolDepartamental] ?? rol;
}
