/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Utilidades transversales
 * Archivo: hora.ts
 * Responsabilidad: Interpretar y comparar horas del día escritas como `HH:MM`.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * El módulo guarda las horas como texto `HH:MM` en `t_ventana_carga` y en los
 * parámetros de política. Es una decisión del diseño aprobado: son horas de reloj de
 * pared, no instantes, y guardarlas como `timestamp` obligaría a inventar una fecha.
 *
 * La contrapartida es que compararlas exige convertirlas, y esa conversión estaba
 * escrita por separado en el evaluador de ventanas y en las reglas de parámetros.
 * Aquí vive una sola vez.
 */

/** Horas válidas de un reloj de 24 horas. Es el mismo patrón que `ck_ventana_horas`. */
export const PATRON_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function esHoraValida(valor: string): boolean {
  return PATRON_HORA.test(valor);
}

/**
 * Convierte `HH:MM` a minutos desde la medianoche.
 * @throws si el texto no es una hora válida: devolver un número inventado desplazaría
 *         una ventana de carga sin que nadie lo notara.
 */
export function aMinutos(hora: string): number {
  if (!esHoraValida(hora)) {
    throw new Error(`«${hora}» no es una hora válida en formato HH:MM.`);
  }
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

/** Formato de lectura del cuadro: `15:00` se muestra como `15H00`. */
export function comoHoraInstitucional(hora: string): string {
  return hora.replace(':', 'H');
}
