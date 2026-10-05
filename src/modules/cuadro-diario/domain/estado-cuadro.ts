/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: estado-cuadro.ts
 * Responsabilidad: Gobernar por qué estados pasa una jornada y en qué orden.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * INV-03. La transición sigue el orden **Borrador → En transporte → Aprobado →
 * Cerrado**, y cada estado corresponde a un momento real del día:
 *
 * | Estado | Qué significa |
 * |---|---|
 * | `BORRADOR` | Los departamentos están cargando sus operativos |
 * | `EN_TRANSPORTE` | La ventana departamental cerró; la DAF asigna conductor y vehículo |
 * | `APROBADO` | La ventana de la DAF cerró; el cuadro está listo para revisión |
 * | `CERRADO` | La Dirección lo congeló. No admite modificaciones (RN-58) |
 *
 * NO SE PUEDE SALTAR NINGUNO, y es el caso 4 del plan. Un cuadro que pasara de
 * borrador a cerrado sería un cuadro que nadie revisó: la Dirección estaría firmando
 * un documento que la DAF no llegó a completar.
 *
 * LA ÚNICA MARCHA ATRÁS es la reapertura, de `CERRADO` a `APROBADO`, y la ejecuta solo
 * la Dirección. No es una transición más: es deshacer la suya propia.
 */

import { EstadoCuadro } from '@prisma/client';

/** Avance normal de la jornada. Cada estado solo lleva al siguiente. */
const SIGUIENTE: Record<EstadoCuadro, EstadoCuadro | undefined> = {
  [EstadoCuadro.BORRADOR]: EstadoCuadro.EN_TRANSPORTE,
  [EstadoCuadro.EN_TRANSPORTE]: EstadoCuadro.APROBADO,
  [EstadoCuadro.APROBADO]: EstadoCuadro.CERRADO,
  [EstadoCuadro.CERRADO]: undefined,
};

/** Cómo se lee cada estado en una frase dirigida al funcionario. */
export const DESCRIPCION_ESTADO: Record<EstadoCuadro, string> = {
  [EstadoCuadro.BORRADOR]: 'en carga departamental',
  [EstadoCuadro.EN_TRANSPORTE]: 'en asignación de transporte',
  [EstadoCuadro.APROBADO]: 'aprobado y listo para el cierre',
  [EstadoCuadro.CERRADO]: 'cerrado por la Dirección',
};

/** El estado que sigue, o `undefined` si es el último. */
export function siguienteEstado(
  actual: EstadoCuadro,
): EstadoCuadro | undefined {
  return SIGUIENTE[actual];
}

/** INV-03. Si el avance de un estado a otro es admisible. */
export function puedeAvanzarA(
  actual: EstadoCuadro,
  destino: EstadoCuadro,
): boolean {
  return SIGUIENTE[actual] === destino;
}

/** RN-58. Un cuadro cerrado no admite modificaciones. */
export function admiteEscritura(estado: EstadoCuadro): boolean {
  return estado !== EstadoCuadro.CERRADO;
}

/** La reapertura es la única marcha atrás, y solo desde el cierre. */
export function puedeReabrirse(estado: EstadoCuadro): boolean {
  return estado === EstadoCuadro.CERRADO;
}

/** Estado al que vuelve un cuadro reabierto: el inmediatamente anterior al cierre. */
export const ESTADO_TRAS_REAPERTURA = EstadoCuadro.APROBADO;
