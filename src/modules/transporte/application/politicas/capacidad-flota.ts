/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.ts
 * Responsabilidad: Comparar la demanda del día contra la capacidad declarada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POL-07 · RN-46. ADVIERTE, NO BLOQUEA. Y esa es toda la política.
 *
 * El Product Owner lo dijo así: nadie sabe cuántos conductores hábiles hay. Bloquear una
 * asignación con un número que nadie ha confirmado dejaría un operativo sin transporte
 * por un dato provisional, y el cuadro se volvería a llenar por WhatsApp —que es el
 * problema que el sistema existe para resolver—.
 *
 * Por eso esta función **no lanza**: devuelve una comparación. Quien la use decide qué
 * hacer con ella, y en todo el módulo lo único que se hace es mostrarla.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ES UNA FUNCIÓN PURA. No consulta la base ni conoce NestJS: recibe dos números por lado
 * y devuelve el veredicto. Ni siquiera sabe qué fecha se está comparando.
 */

/** Lo declarado por la DAF para una fecha. */
export interface CapacidadDeclarada {
  vehiculosHabiles: number;
  conductoresHabiles: number;
}

/** Lo que la jornada necesita. */
export interface DemandaDelDia {
  /** Operativos que requieren vehículo, incluidos los que ya lo tienen asignado. */
  vehiculosRequeridos: number;
  /** El mismo número: un operativo con vehículo lleva un conductor. */
  conductoresRequeridos: number;
}

/** Comparación de un recurso concreto. */
export interface Holgura {
  declarados: number;
  requeridos: number;
  /** Positivo o cero: sobra. Negativo: falta. */
  excedente: number;
  suficiente: boolean;
}

export interface VeredictoCapacidad {
  vehiculos: Holgura;
  conductores: Holgura;
  /** VAL-24. Si alguno de los dos no alcanza. */
  hayAdvertencia: boolean;
  /** Redactado para la DAF: se muestra tal cual, o queda vacío si todo alcanza. */
  advertencia: string | null;
}

/**
 * Compara demanda contra capacidad y redacta la advertencia.
 *
 * @returns siempre un veredicto. **Nunca lanza**: RN-46 advierte sin bloquear.
 */
export function verificarCapacidad(
  declarada: CapacidadDeclarada,
  demanda: DemandaDelDia,
): VeredictoCapacidad {
  const vehiculos = comparar(
    declarada.vehiculosHabiles,
    demanda.vehiculosRequeridos,
  );
  const conductores = comparar(
    declarada.conductoresHabiles,
    demanda.conductoresRequeridos,
  );

  const faltantes: string[] = [];

  if (!vehiculos.suficiente) {
    faltantes.push(
      `${-vehiculos.excedente} ${plural(-vehiculos.excedente, 'vehículo', 'vehículos')}`,
    );
  }

  if (!conductores.suficiente) {
    faltantes.push(
      `${-conductores.excedente} ${plural(-conductores.excedente, 'conductor', 'conductores')}`,
    );
  }

  const hayAdvertencia = faltantes.length > 0;

  return {
    vehiculos,
    conductores,
    hayAdvertencia,
    advertencia: hayAdvertencia
      ? `La jornada necesita ${faltantes.join(' y ')} más de los declarados como hábiles. La asignación sigue permitida: revise la disponibilidad real antes de cerrar el cuadro.`
      : null,
  };
}

function comparar(declarados: number, requeridos: number): Holgura {
  const excedente = declarados - requeridos;

  return {
    declarados,
    requeridos,
    excedente,
    suficiente: excedente >= 0,
  };
}

function plural(cantidad: number, singular: string, plural: string): string {
  return cantidad === 1 ? singular : plural;
}
