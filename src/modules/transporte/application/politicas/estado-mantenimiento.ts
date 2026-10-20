/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · mantenimiento
 * Archivo: estado-mantenimiento.ts
 * Responsabilidad: Decir qué cambios de estado admite una cita de taller y validar los vales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Una cita de taller avanza PROGRAMADO → EN_TALLER → LISTO. Se admite también PROGRAMADO → LISTO
 * (se resolvió sin entrar al taller) y volver EN_TALLER → PROGRAMADO (se reprogramó). LISTO es
 * final: el vehículo volvió a circulación. Puro.
 */

export type EstadoCita = 'PROGRAMADO' | 'EN_TALLER' | 'LISTO';

const TRANSICIONES: Record<EstadoCita, readonly EstadoCita[]> = {
  PROGRAMADO: ['EN_TALLER', 'LISTO'],
  EN_TALLER: ['LISTO', 'PROGRAMADO'],
  LISTO: [],
};

export function puedeTransitar(desde: EstadoCita, hacia: EstadoCita): boolean {
  return TRANSICIONES[desde].includes(hacia);
}

/** Los montos de los vales de combustible de la DAF. */
export const MONTOS_VALE = [10, 20] as const;

export function montoValeValido(monto: number): boolean {
  return (MONTOS_VALE as readonly number[]).includes(monto);
}
