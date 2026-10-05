/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: estado-orden.ts
 * Responsabilidad: UNA fuente de verdad para el estado, los faltantes, el firmante y el número.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * El estado de una orden (VIGENTE/BORRADOR/REEMPLAZADA), qué datos obligatorios faltan, el firmante
 * congelado y el número AMC-OS se derivan AQUÍ y nada más. Lo usan el servicio (para decidir cuándo
 * asignar número) y el DTO (para la respuesta), de modo que tabla, panel, tarjeta y visor coinciden.
 */

import {
  resolverTokens,
  type ApartadoConTokens,
  type Faltante,
  type FuenteTokens,
} from './resolver-tokens';

export type { Faltante, OrigenFaltante } from './resolver-tokens';

/** Estado único derivado. «Pendiente» es a nivel de operativo (sin órdenes), no de orden. */
export type EstadoOrden = 'VIGENTE' | 'BORRADOR' | 'REEMPLAZADA';

/** Firmante congelado en la orden (copia del Director en sesión al emitir). */
export interface FirmanteOrden {
  nombre: string;
  cargo: string;
  dependencia: string;
}

/** El firmante persistido en la orden (si lo hay), con sus tres textos. */
export function firmanteDeOrden(firmante: unknown): FirmanteOrden | null {
  if (firmante === null || typeof firmante !== 'object') return null;
  const dato = firmante as Record<string, unknown>;
  return {
    nombre: typeof dato.nombre === 'string' ? dato.nombre : '',
    cargo: typeof dato.cargo === 'string' ? dato.cargo : '',
    dependencia: typeof dato.dependencia === 'string' ? dato.dependencia : '',
  };
}

/**
 * Qué datos obligatorios faltan. Una SOLA definición: delega en `resolverTokens`, de modo que el
 * estado del DTO, el PDF y la validación de emisión listan exactamente lo mismo (D12/D16). Es
 * plantilla-aware: un token que la plantilla no usa no cuenta como faltante (D15).
 */
export function faltantesDeOrden(
  apartados: ApartadoConTokens[],
  fuente: FuenteTokens,
): Faltante[] {
  return resolverTokens(apartados, fuente).faltantes;
}

/** AMC-OS-00005572-2026. Solo cuando la orden tiene número (Vigente). */
export function formatearNumeroOrden(
  anio: number | null,
  secuencial: number | null,
): string | null {
  if (anio === null || secuencial === null) return null;
  return `AMC-OS-${String(secuencial).padStart(8, '0')}-${anio}`;
}

/** La versión (nº de emisión) del sufijo del código `OS-...-N`; 1 si no se puede leer. */
export function versionDeCodigo(codigo: string): number {
  const ultimo = codigo.split('-').pop();
  const numero = Number(ultimo);
  return Number.isInteger(numero) && numero > 0 ? numero : 1;
}

/**
 * El estado ÚNICO de una orden (2026-10-05):
 *  · REEMPLAZADA si ya no es vigente (una reemisión la sustituyó).
 *  · VIGENTE si TIENE número AMC-OS y no le falta nada contra SU versión de plantilla.
 *  · BORRADOR en cualquier otro caso: le faltan datos, o aún no se le asignó número.
 *
 * El número se asigna justo al quedar sin faltantes, así que en la práctica «sin faltantes» y «con
 * número» van juntos. Una REEMISIÓN incompleta conserva su número RESERVADO (decisión del usuario,
 * 2026-10-05) pero se expone como BORRADOR —y la respuesta no muestra el número— hasta completarse.
 */
export function estadoDeOrden(
  vigente: boolean,
  faltantes: Faltante[],
  tieneNumero: boolean,
): EstadoOrden {
  if (!vigente) return 'REEMPLAZADA';
  return faltantes.length === 0 && tieneNumero ? 'VIGENTE' : 'BORRADOR';
}
