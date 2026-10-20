/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias
 * Archivo: reglas-ausencia.ts
 * Responsabilidad: Reglas puras de los períodos de ausencia (rango, solape, momento) y de las
 *                  fechas de calendario, compartidas por el personal y los conductores.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * SALIERON DE `talento-operativo/application/reglas-personal.ts` EL 2026-10-16, sin cambiar una
 * línea, cuando la flota empezó a registrar ausencias de CONDUCTORES (plan
 * «ausencias-conductores-flota»). Las dos ausencias son el mismo dato en la misma tabla
 * (`t_disponibilidad`) y deben medirse con la misma vara: una copia en `transporte` habría
 * podido divergir. `reglas-personal.ts` las reexporta, así que nadie cambió de importación.
 *
 * NO SON REGLAS DE DESCANSO (regla 1 de CLAUDE.md): dicen si dos períodos se cruzan y en qué
 * momento está uno respecto de hoy, no si una persona puede trabajar.
 */

import { EstadoDisponibilidad } from '@prisma/client';

/** Fecha sin hora, tal como la guarda `@db.Date`. */
export interface Periodo {
  desde: Date;
  hasta: Date;
}

/**
 * RN-30. Estados que EXCLUYEN a la persona de un operativo.
 *
 * `DISPONIBLE` no excluye —es el registro explícito de que sí está— y `MANTENIMIENTO`
 * no le corresponde: es de vehículos. Enumerar los que excluyen, en lugar de los que
 * no, evita que un estado nuevo entre por omisión como excluyente sin que nadie lo
 * decida.
 */
export const ESTADOS_QUE_EXCLUYEN: EstadoDisponibilidad[] = [
  EstadoDisponibilidad.VACACIONES,
  EstadoDisponibilidad.REPOSO_MEDICO,
  EstadoDisponibilidad.CALAMIDAD,
  EstadoDisponibilidad.PERMISO,
  // Rediseño de P-07, 2026-10-08: tres situaciones más, que excluyen igual que las cuatro de
  // arriba. Se enumeran aquí —no entran «por omisión»— porque así lo decidió el negocio.
  EstadoDisponibilidad.LICENCIA,
  EstadoDisponibilidad.CAPACITACION,
  EstadoDisponibilidad.COMISION_SERVICIOS,
];

/** Estados que puede tener una persona. `MANTENIMIENTO` es solo de vehículos. */
export const ESTADOS_DE_PERSONA: EstadoDisponibilidad[] = [
  EstadoDisponibilidad.DISPONIBLE,
  ...ESTADOS_QUE_EXCLUYEN,
];

export function excluyeDelOperativo(estado: EstadoDisponibilidad): boolean {
  return ESTADOS_QUE_EXCLUYEN.includes(estado);
}

// ─────────────────────────── Períodos ───────────────────────────

/**
 * INV-14. Dos períodos de la misma persona no pueden solaparse.
 *
 * Los extremos son INCLUSIVOS: una ausencia del 1 al 15 comprende ambos días, y una
 * de un solo día tiene `desde` igual a `hasta`. Por eso la comparación usa `<=` y no
 * `<`, al revés que `RangoHorario`, donde encadenar dos operativos a la misma hora sí
 * es legítimo. Aquí encadenar sería estar dos veces ausente el mismo día.
 */
export function seSolapan(uno: Periodo, otro: Periodo): boolean {
  return uno.desde <= otro.hasta && otro.desde <= uno.hasta;
}

/** En qué momento está una ausencia respecto de hoy. */
export type EstadoDeAusencia = 'EN_CURSO' | 'PROXIMA' | 'PASADA';

/**
 * Estado de una ausencia respecto de «hoy», todo en `AAAA-MM-DD` (fechas de calendario,
 * extremos inclusivos, como `seSolapan`). En ese formato el orden alfabético es el
 * cronológico, así que se comparan cadenas y no hay huso que desplace un día.
 *
 * Decide dos cosas: qué distintivo se muestra (En curso / Próxima / Pasada) y si la ausencia
 * se puede quitar (una PASADA ya no: B7 del rediseño de P-07).
 */
export function estadoDeAusencia(
  desde: string,
  hasta: string,
  hoy: string,
): EstadoDeAusencia {
  if (hasta < hoy) return 'PASADA';
  if (desde > hoy) return 'PROXIMA';
  return 'EN_CURSO';
}

/** Un período cubre la fecha indicada. */
export function cubre(periodo: Periodo, fecha: Date): boolean {
  return periodo.desde <= fecha && fecha <= periodo.hasta;
}

/**
 * Interpreta una fecha `AAAA-MM-DD` en UTC.
 *
 * Las columnas son `@db.Date`, sin hora ni zona. Interpretarlas con el huso del
 * proceso desplazaría la ausencia un día en cualquier servidor al oeste de Greenwich
 * —Quito lo está—, y una persona figuraría disponible el día que empieza su reposo
 * médico.
 */
/**
 * Escribe una fecha de calendario como `AAAA-MM-DD`.
 *
 * Es la operación inversa de `aFechaUtc` y estaba escrita dos veces: en el servicio,
 * para los mensajes, y en el DTO, para la respuesta. Dos copias del mismo corte de
 * cadena que podían divergir en el momento en que una de las dos cambiara de huso.
 */
export function comoFechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function aFechaUtc(texto: string): Date | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return undefined;

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  const correcta =
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia;

  return correcta ? fecha : undefined;
}
