/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · capacidad de flota
 * Archivo: capacidad-calculada.ts
 * Responsabilidad: Calcular la capacidad hábil del día a partir de turnos, ausencias y taller.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA CAPACIDAD YA NO SE TECLEA: SE CALCULA (2026-10-06, mejoras de usabilidad DAF).
 *
 * Hasta hoy la DAF escribía a mano cuántos conductores y vehículos tenía hábiles, y la cifra no
 * se contrastaba con nada. Ahora sale de los datos que ya carga:
 *
 *   · CONDUCTORES HÁBILES = conductores activos con turno TRABAJABLE ese día (DIA, NOCHE o
 *     ECU_NOCHE) − los que tienen una ausencia ese día (t_disponibilidad) + los LIBRES ACTIVADOS
 *     (t_activacion_conductor) que no estén ya contados ni ausentes.
 *     ADMINISTRATIVO NO cuenta: ese día no sale a operativos. LIBRE solo cuenta si se activó.
 *   · VEHÍCULOS HÁBILES = vehículos activos − los que están en taller ese día.
 *
 * La DAF la CONFIRMA o la CORRIGE (con observación obligatoria, ver `capacidad-flota.service`):
 * lo declarado sigue alimentando RN-46 como antes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Turnos que ponen al conductor en la calle ese día. */
export const TURNOS_TRABAJABLES: ReadonlySet<string> = new Set([
  'DIA',
  'NOCHE',
  'ECU_NOCHE',
]);

export interface EntradaCapacidad {
  /** Ids de los conductores activos. */
  conductoresActivos: readonly number[];
  /** El turno de cada conductor ese día (los que no tienen turno, ausentes del mapa). */
  turnos: ReadonlyMap<number, string>;
  /** Conductores con una ausencia ese día. */
  ausentes: ReadonlySet<number>;
  /** Conductores LIBRES activados ese día (horas extra). */
  activados: ReadonlySet<number>;
  /** Ids de los vehículos activos. */
  vehiculosActivos: readonly number[];
  /** Vehículos en taller ese día. */
  enTaller: ReadonlySet<number>;
}

export interface CapacidadCalculada {
  calculada: { conductoresHabiles: number; vehiculosHabiles: number };
  detalle: {
    /** Conductores activos con turno trabajable (antes de restar ausencias). */
    conductoresConTurno: number;
    /** De esos, los que tienen una ausencia ese día. */
    conductoresAusentes: number;
    /** Libres activados que suman (no ausentes ni ya contados por turno). */
    libresActivados: number;
    /** Vehículos activos. */
    flota: number;
    /** De esos, los que están en taller. */
    enTaller: number;
  };
}

/** Calcula la capacidad hábil del día. Pura: no toca la base. */
export function calcularCapacidad(
  entrada: EntradaCapacidad,
): CapacidadCalculada {
  const activos = new Set(entrada.conductoresActivos);

  const conTurno = [...activos].filter((id) =>
    TURNOS_TRABAJABLES.has(entrada.turnos.get(id) ?? ''),
  );
  const ausentesConTurno = conTurno.filter((id) => entrada.ausentes.has(id));
  const contados = new Set(conTurno);
  const libres = [...entrada.activados].filter(
    (id) => activos.has(id) && !contados.has(id) && !entrada.ausentes.has(id),
  );

  const flota = new Set(entrada.vehiculosActivos);
  const enTaller = [...flota].filter((id) => entrada.enTaller.has(id));

  return {
    calculada: {
      conductoresHabiles:
        conTurno.length - ausentesConTurno.length + libres.length,
      vehiculosHabiles: flota.size - enTaller.length,
    },
    detalle: {
      conductoresConTurno: conTurno.length,
      conductoresAusentes: ausentesConTurno.length,
      libresActivados: libres.length,
      flota: flota.size,
      enTaller: enTaller.length,
    },
  };
}
