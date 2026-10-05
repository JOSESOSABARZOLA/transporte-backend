/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: contexto-peticion.ts
 * Responsabilidad: Transportar el identificador de correlación y la identidad a lo
 *                  largo de la petición, sin pasarlos por parámetro en cada llamada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Usa AsyncLocalStorage, que es de la biblioteca estándar de Node: no incorpora
 * ninguna dependencia. Permite que el registro y la auditoría conozcan la
 * correlación y el usuario sin que cada servicio tenga que arrastrarlos.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { RolDepartamental } from '@prisma/client';

export interface ContextoPeticion {
  /** Identificador que enlaza toda la petición, del clic a la consulta. */
  correlacionId: string;
  /** Lo completa `IdentidadGuard` al resolver al usuario. */
  usuarioId?: number;
  rol?: RolDepartamental;
  metodo: string;
  ruta: string;
}

const almacen = new AsyncLocalStorage<ContextoPeticion>();

/** Ejecuta el resto de la petición con el contexto disponible. */
export function ejecutarConContexto<T>(
  contexto: ContextoPeticion,
  operacion: () => T,
): T {
  return almacen.run(contexto, operacion);
}

/** Devuelve el contexto de la petición en curso, si existe. */
export function obtenerContexto(): ContextoPeticion | undefined {
  return almacen.getStore();
}

/**
 * Completa la identidad una vez resuelta. Lo invoca `IdentidadGuard`, que se ejecuta
 * después del middleware de correlación.
 */
export function registrarIdentidad(
  usuarioId: number,
  rol: RolDepartamental,
): void {
  const contexto = almacen.getStore();
  if (contexto) {
    contexto.usuarioId = usuarioId;
    contexto.rol = rol;
  }
}
