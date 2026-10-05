/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: alcance-parametro.ts
 * Responsabilidad: Decidir qué rol puede ver y editar cada parámetro de política.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO TODOS LOS PARÁMETROS SON DEL MISMO ADMINISTRADOR.
 *
 * Las ventanas de los turnos de la cobertura de Instrucción las administra el
 * ADMINISTRADOR_DMIT, que es quien gobierna esa matriz. El resto de la configuración de
 * política sigue siendo del ADMINISTRADOR_DMIP y del ADMINISTRADOR general. Cada rol ve en
 * «Ventanas y parámetros» solo lo suyo: el DMIT ve **solo** los turnos; los otros dos, todo
 * **menos** los turnos. Quien tenga ambos roles ve la unión.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { RolDepartamental } from '@prisma/client';

/**
 * Parámetros que SOLO administra el ADMINISTRADOR_DMIT: las ventanas horarias de los turnos
 * diurno y nocturno de la cobertura de Instrucción.
 */
export const PARAMETROS_SOLO_DMIT: ReadonlySet<string> = new Set([
  'HORA_TURNO_DIURNO_INICIO',
  'HORA_TURNO_DIURNO_FIN',
  'HORA_TURNO_NOCTURNO_INICIO',
  'HORA_TURNO_NOCTURNO_FIN',
]);

/** ¿Quién administra la configuración general (todo lo que no son los turnos)? */
function esAdministradorGeneral(roles: readonly RolDepartamental[]): boolean {
  return (
    roles.includes(RolDepartamental.ADMINISTRADOR_DMIP) ||
    roles.includes(RolDepartamental.ADMINISTRADOR)
  );
}

/**
 * ¿Pueden estos roles ver y editar este parámetro? Un parámetro de turno es del DMIT; el
 * resto, del administrador general. Con ambos roles se cumplen las dos condiciones.
 */
export function puedeVerParametro(
  clave: string,
  roles: readonly RolDepartamental[],
): boolean {
  if (PARAMETROS_SOLO_DMIT.has(clave)) {
    return roles.includes(RolDepartamental.ADMINISTRADOR_DMIT);
  }
  return esAdministradorGeneral(roles);
}
