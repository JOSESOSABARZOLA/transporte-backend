/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: linea-de-tiempo.ts
 * Responsabilidad: Llevar las horas HH:MM de la jornada a minutos de UNA línea de tiempo continua.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA JORNADA DE TRANSPORTE VA DE 05H00 A 05H00 (parámetro INICIO_JORNADA_TRANSPORTE, regla 2).
 *
 * Un conductor puede tener a las 02H00 una salida a Cumbayá que pertenece a la NOCHE del mismo día
 * del cuadro, no a la mañana. Por eso una hora anterior al inicio de la jornada se cuenta al día
 * siguiente (+1440 min): todas las comparaciones —solapamiento, traslado, jornada— se hacen sobre
 * una sola recta numérica. Los minutos se cuentan desde las 00H00 del día del cuadro, así que pueden
 * superar 1440.
 *
 * ES PURA: no lee la base ni el reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Minutos de un día: 1440. */
export const MINUTOS_DIA = 1440;

/** Una franja de la línea de tiempo, en minutos desde las 00H00 del día del cuadro. */
export interface Franja {
  inicio: number;
  fin: number;
}

/** «HH:MM» → minutos desde la medianoche (0..1439). */
export function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

/** Minutos (de cualquier tamaño) → «HH:MM» del reloj. */
export function aHora(minutos: number): string {
  const enDia = ((minutos % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  const horas = Math.floor(enDia / 60);
  const resto = enDia % 60;
  return `${String(horas).padStart(2, '0')}:${String(resto).padStart(2, '0')}`;
}

/** «HH:MM» → «HH:MM» institucional («06H30»), para los mensajes. */
export function institucional(minutos: number): string {
  return aHora(minutos).replace(':', 'H');
}

/**
 * El minuto de la línea de tiempo de una hora de la jornada: si es anterior al inicio de la
 * jornada, pertenece a la noche y se cuenta al día siguiente.
 */
export function minutoDeJornada(hora: string, inicioJornada: string): number {
  const minuto = aMinutos(hora);
  return minuto < aMinutos(inicioJornada) ? minuto + MINUTOS_DIA : minuto;
}

/**
 * La franja de un horario de la jornada. Si el fin no queda después del inicio (cruce del límite
 * de la jornada), se lleva al día siguiente.
 */
export function franjaDe(
  horaInicio: string,
  horaFin: string,
  inicioJornada: string,
): Franja {
  const inicio = minutoDeJornada(horaInicio, inicioJornada);
  let fin = minutoDeJornada(horaFin, inicioJornada);
  if (fin <= inicio) fin += MINUTOS_DIA;
  return { inicio, fin };
}

/** ¿Se pisan dos franjas? Tocarse en el borde (una termina cuando empieza la otra) no es pisarse. */
export function seSolapan(a: Franja, b: Franja): boolean {
  return a.inicio < b.fin && b.inicio < a.fin;
}

/** ¿Está la franja entera dentro de la ventana? */
export function estaDentro(franja: Franja, ventana: Franja): boolean {
  return franja.inicio >= ventana.inicio && franja.fin <= ventana.fin;
}

/**
 * Lleva una franja de la escala INTERNA (minutos desde las 00H00 del día del cuadro) a la escala
 * de la LÍNEA que pinta el frontend: minutos desde `inicioJornada`. Es solo de presentación —las
 * comparaciones se siguen haciendo en la escala interna—. Con inicio 05:00, el turno 06:00–17:00
 * ({360,1020}) queda {60,720}. Corrige el desfase de +5 h del dibujo (2026-10-07).
 */
export function aEscalaDeLinea(franja: Franja, inicioJornada: string): Franja {
  const origen = aMinutos(inicioJornada);
  return { inicio: franja.inicio - origen, fin: franja.fin - origen };
}
