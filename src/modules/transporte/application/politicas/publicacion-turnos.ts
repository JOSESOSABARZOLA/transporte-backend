/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: publicacion-turnos.ts
 * Responsabilidad: Decidir qué turnos de conductores cuentan: solo los de un mes PUBLICADO.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * PUBLICAR HABILITA (versión consolidada). Hasta el 2026-10-06 el estado del mes era informativo y
 * la asignación usaba el turno guardado aunque el mes siguiera en borrador. Ahora la planificación,
 * la evaluación, la capacidad y el optimizador leen SOLO los turnos de un mes PUBLICADO o PUBLICADO
 * CON CAMBIOS: en BORRADOR el conductor no tiene turno (como si la celda estuviera vacía). La matriz
 * mensual sigue mostrando el borrador: es donde se prepara. Es pura.
 */

export const ESTADOS_PUBLICADOS: readonly string[] = [
  'PUBLICADO',
  'PUBLICADO_CON_CAMBIOS',
];

export function estaPublicado(estado: string | null | undefined): boolean {
  return (
    estado !== null &&
    estado !== undefined &&
    ESTADOS_PUBLICADOS.includes(estado)
  );
}

/** AAAA-MM de una columna @db.Date (medianoche UTC), sin desplazarla por el huso. */
export function mesDe(fecha: Date): string {
  return fecha.toISOString().slice(0, 7);
}

/** Los meses AAAA-MM que toca un rango de fechas @db.Date, en orden. */
export function mesesDelRango(desde: Date, hasta: Date): string[] {
  const meses: string[] = [];
  for (
    let cursor = new Date(
      Date.UTC(desde.getUTCFullYear(), desde.getUTCMonth(), 1),
    );
    cursor <= hasta;
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
    )
  )
    meses.push(mesDe(cursor));
  return meses;
}

/** Los turnos cuyo mes está publicado; los de un mes en borrador se descartan. */
export function soloPublicados<T extends { fecha: Date }>(
  turnos: readonly T[],
  mesesPublicados: ReadonlySet<string>,
): T[] {
  return turnos.filter((t) => mesesPublicados.has(mesDe(t.fecha)));
}
