/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: ocupacion-vehiculo.ts
 * Responsabilidad: Decidir si un vehículo está libre en el horario que se le pide.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-28
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * RN-DAF-01. LA MISMA PLACA NO PUEDE ESTAR EN DOS SITIOS A LA VEZ.
 *
 * Hasta hoy el sistema lo comprobaba para el conductor —VAL-21— y no para el vehículo.
 * `exigirVehiculoUtilizable` verificaba que existiera, que no estuviera de baja y que no
 * estuviera en taller **ese día**, pero no comparaba horas en ningún momento: la misma
 * placa podía servir a cuatro operativos simultáneos sin un solo aviso, y el defecto no
 * se manifestaba hasta la mañana de la ejecución, cuando tres de ellos se quedaban sin
 * carro.
 *
 * Lo levantó Planificación de Transporte el 2026-08-28. Es la única de las restricciones
 * que la analista aplica de memoria y que el sistema no sostenía de ninguna forma.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO ES UNA REGLA DE DESCANSO, Y POR ESO VIVE AQUÍ Y NO EN `talento-operativo`.
 *
 * Se parece a VAL-21 —misma aritmética, mensaje casi igual— y la semejanza invita a
 * moverla junto a las demás. Sería un error: la regla 1 de CLAUDE.md reserva
 * `talento-operativo` para lo que protege a las PERSONAS, y aquí no se protege a nadie.
 * Un vehículo no se fatiga ni tiene jornada máxima; lo único que no puede es estar en dos
 * puntos de la ciudad al mismo tiempo. Es ocupación de un activo, y el activo es de este
 * submódulo.
 *
 * ES UNA FUNCIÓN PURA, como `capacidad-flota.ts`: recibe lo que ya está ocupado y lo que
 * se pretende, y devuelve un veredicto. No consulta la base, no conoce NestJS y no lanza.
 *
 * LA ARITMÉTICA NO SE REESCRIBE. El cruce de medianoche es «la fuente de error más
 * probable en todo el sistema» (FASE3 §OV-02) y ya está resuelto en `RangoHorario`. Aquí
 * se le pregunta. Una segunda versión de esa comparación es exactamente lo que ese objeto
 * de valor existe para impedir.
 */

import type { RangoHorario } from '../../../operativos/domain/rango-horario';

/** Operativo al que el vehículo ya está asignado en la fecha. */
export interface OcupacionVigente {
  identificador: string;
  rango: RangoHorario;
}

/** Lo que decide la regla. Nunca lanza: quien pregunta resuelve qué hacer con esto. */
export interface VeredictoOcupacion {
  libre: boolean;
  /** El primer operativo que se cruza. Ausente si el vehículo está libre. */
  conflicto?: OcupacionVigente;
  /** Redactado para la DAF y mostrado tal cual (regla 8 de CLAUDE.md). */
  motivo?: string;
}

/**
 * RN-DAF-01. Comprueba si el vehículo puede tomar un horario más.
 *
 * Devuelve el PRIMER conflicto y no todos, deliberadamente: la DAF corrige uno y vuelve
 * a intentar, y enumerar los cuatro cruces de una placa sobrecargada no cambia lo que
 * tiene que hacer. El mensaje nombra el operativo y su horario, que es lo que le permite
 * decidir si mueve este o el otro.
 *
 * @returns siempre un veredicto. **Nunca lanza.**
 */
export function verificarOcupacionVehiculo(
  placa: string,
  ocupaciones: readonly OcupacionVigente[],
  rango: RangoHorario,
): VeredictoOcupacion {
  const conflicto = ocupaciones.find((ocupacion) =>
    ocupacion.rango.seSolapaCon(rango),
  );

  if (!conflicto) return { libre: true };

  return {
    libre: false,
    conflicto,
    motivo: `El vehículo de placa ${placa} ya está asignado al operativo ${conflicto.identificador}, de ${conflicto.rango.toString()}, que se cruza con este horario.`,
  };
}
