/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: marca-tiempo.ts
 * Responsabilidad: Componer marcas de tiempo ISO 8601 con el desfase de la zona
 *                  horaria institucional.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * `toISOString()` devuelve siempre UTC, y el formato de error del apartado §11.2
 * de la guía muestra el desfase local: `2026-07-31T09:14:22-05:00`.
 *
 * La zona se toma de la configuración y NO de la del proceso: `dotenv` carga TZ
 * después de que Node haya fijado su zona horaria, de modo que en desarrollo local
 * el proceso puede estar en otra distinta a `America/Guayaquil`. Formatear con la
 * zona explícita hace el resultado independiente de dónde se ejecute.
 */

import { appConfig } from '../../config/app.config';

type ParteFecha = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second';

/**
 * Formateadores memorizados por zona horaria.
 *
 * Construir un `Intl.DateTimeFormat` es de las operaciones más caras de la biblioteca
 * estándar: carga y compila los datos de la zona. Estas tres funciones se invocan en
 * CADA línea de registro y en CADA evaluación de ventana, de modo que se construía uno
 * nuevo varias veces por petición. Memorizarlos no cambia el resultado: el formateador
 * no guarda estado entre llamadas.
 */
const formateadores = new Map<string, Intl.DateTimeFormat>();

function formateador(
  clave: string,
  construir: () => Intl.DateTimeFormat,
): Intl.DateTimeFormat {
  const memorizado = formateadores.get(clave);
  if (memorizado) return memorizado;

  const nuevo = construir();
  formateadores.set(clave, nuevo);
  return nuevo;
}

/**
 * Devuelve la fecha en ISO 8601 con el desfase de la zona indicada.
 * @example "2026-08-05T09:14:22-05:00"
 */
export function marcaDeTiempo(
  fecha: Date = new Date(),
  zonaHoraria: string = appConfig.zonaHoraria,
): string {
  const conDesfase = formateador(
    `marca:${zonaHoraria}`,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaHoraria,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'longOffset',
      }),
  );

  const partes = new Map<string, string>(
    conDesfase.formatToParts(fecha).map((parte) => [parte.type, parte.value]),
  );

  const valor = (tipo: ParteFecha): string => partes.get(tipo) ?? '00';

  // Intl entrega el desfase como "GMT-05:00"; el formato ISO lo quiere como "-05:00".
  // Con UTC devuelve "GMT" o "GMT+00:00" según la implementación, y en ISO el desfase
  // nulo se escribe "Z", igual que hace toISOString().
  const desfaseBruto = partes.get('timeZoneName') ?? 'GMT';
  const desfaseNumerico = desfaseBruto.replace('GMT', '');
  const desfase =
    desfaseNumerico === '' || desfaseNumerico === '+00:00'
      ? 'Z'
      : desfaseNumerico;

  const milisegundos = String(fecha.getMilliseconds()).padStart(3, '0');

  return (
    `${valor('year')}-${valor('month')}-${valor('day')}` +
    `T${valor('hour')}:${valor('minute')}:${valor('second')}.${milisegundos}${desfase}`
  );
}

/**
 * Hora del día en la zona indicada, en formato `HH:MM`.
 *
 * Las ventanas de carga se evalúan SIEMPRE en `America/Guayaquil`, no en la zona del
 * proceso. Si esto se calculara con la hora local del servidor, los cierres de las
 * 15H00 ocurrirían a otra hora y nadie lo notaría hasta que un departamento perdiera
 * su ventana. Es el riesgo RT-03.
 */
export function horaEnZona(
  fecha: Date = new Date(),
  zonaHoraria: string = appConfig.zonaHoraria,
): string {
  return formateador(
    `hora:${zonaHoraria}`,
    () =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: zonaHoraria,
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }),
  ).format(fecha);
}

/** Día de la semana ISO en la zona indicada: 1 es lunes y 7 es domingo. */
export function diaIsoEnZona(
  fecha: Date = new Date(),
  zonaHoraria: string = appConfig.zonaHoraria,
): number {
  const nombre = formateador(
    `dia:${zonaHoraria}`,
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: zonaHoraria,
        weekday: 'short',
      }),
  ).format(fecha);

  const dias: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  const dia = dias[nombre];
  if (dia === undefined) {
    // Antes devolvía 1 en silencio. Un lunes supuesto desplaza la ventana de carga de
    // un rol un día entero, y nadie lo notaría hasta que un departamento perdiera la
    // suya. Es RT-03: mejor un fallo visible que una hora incorrecta.
    throw new Error(
      `No se pudo determinar el día de la semana en la zona ${zonaHoraria}.`,
    );
  }
  return dia;
}

/**
 * Día de calendario en la zona indicada, como `AAAA-MM-DD`.
 *
 * Es «hoy» para las reglas que comparan fechas de calendario (`@db.Date`): una ausencia
 * pasada, en curso o próxima. A las 20H00 de Quito ya es mañana en UTC, así que «hoy» con
 * `toISOString()` adelantaría el día cinco horas antes de tiempo.
 */
export function fechaIsoEnZona(
  fecha: Date = new Date(),
  zonaHoraria: string = appConfig.zonaHoraria,
): string {
  return formateador(
    `fecha:${zonaHoraria}`,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaHoraria,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  ).format(fecha);
}
