/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Cuadro diario
 * Archivo: semana-iso.ts
 * Responsabilidad: Calcular el número y el año de la semana según ISO 8601.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * RN-06. El número de semana **se calcula y es de solo lectura**. Nunca llega del
 * cliente: es exactamente el campo que el Product Owner describió equivocándose al
 * escribirlo a mano, junto con el año.
 *
 * POR QUÉ NO SE USA `Intl` NI UNA BIBLIOTECA. La regla de ISO 8601 cabe en diez
 * líneas y depende de una definición precisa: **la semana 1 es la que contiene el
 * primer jueves del año**. De ahí salen los dos casos que todo cálculo casero falla:
 *
 *   · el 31 de diciembre puede pertenecer a la semana 1 del año SIGUIENTE;
 *   · el 1 de enero puede pertenecer a la semana 52 o 53 del año ANTERIOR.
 *
 * Por eso se devuelven SIEMPRE los dos valores juntos. Guardar el número sin su año
 * —`cuad_nro_semana` sin `cuad_anio_semana`— haría que la semana 1 de enero y la
 * semana 1 del diciembre anterior fueran indistinguibles.
 *
 * Todo se calcula en UTC: `cuad_fecha` es `@db.Date`, una fecha de calendario y no un
 * instante. Mismo criterio que en M-11.
 */

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;
const JUEVES = 4;

export interface SemanaIso {
  /** De 1 a 53. */
  numero: number;
  /** El año al que pertenece la SEMANA, que puede no ser el de la fecha. */
  anio: number;
}

/**
 * Devuelve la semana ISO 8601 de una fecha de calendario.
 *
 * El algoritmo es el canónico: se lleva la fecha al jueves de su semana y se cuenta
 * cuántas semanas han pasado desde el 1 de enero de ESE año. El jueves manda porque
 * es el día que decide a qué año pertenece la semana entera.
 */
export function semanaIso(fecha: Date): SemanaIso {
  const jueves = new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
  );

  // getUTCDay() da 0 para domingo; ISO numera de 1 (lunes) a 7 (domingo).
  const diaIso = jueves.getUTCDay() === 0 ? 7 : jueves.getUTCDay();
  jueves.setUTCDate(jueves.getUTCDate() + JUEVES - diaIso);

  const anio = jueves.getUTCFullYear();
  const primeroDeEnero = new Date(Date.UTC(anio, 0, 1));
  const diasTranscurridos =
    (jueves.getTime() - primeroDeEnero.getTime()) / MILISEGUNDOS_POR_DIA;

  return { numero: Math.floor(diasTranscurridos / 7) + 1, anio };
}
