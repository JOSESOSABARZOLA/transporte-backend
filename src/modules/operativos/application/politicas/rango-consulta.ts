/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Mis operativos · consulta por rango de fechas
 * Archivo: rango-consulta.ts
 * Responsabilidad: Resolver el rango Desde–Hasta del listado, la fecha del cuadro vigente y si
 *                  una fila admite edición.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * ES UNA FUNCIÓN PURA. Recibe textos AAAA-MM-DD, el momento y el veredicto de la ventana; no
 * consulta la base ni conoce NestJS.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CUADRO VIGENTE ES EL DE MAÑANA, en la zona de la institución.
 *
 * Es la misma regla que el frontend usa para proponer la jornada (`fechaDeJornadaPorDefecto`,
 * `utils/jornada.util.ts`): el cuadro que se arma hoy es el que se ejecuta al día siguiente.
 * Se calcula en America/Guayaquil y no en UTC: a las 19H00 de Quito ya es mañana en UTC y el
 * vigente saltaría un día cinco horas antes de tiempo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { EstadoCuadro } from '@prisma/client';

import { ValidacionError } from '../../../../common/errors/errores-dominio';
import { fechaIsoEnZona } from '../../../../common/utilidades/marca-tiempo';
import { admiteEscritura } from '../../../cuadro-diario/domain/estado-cuadro';

/** Clave del parámetro de política con el rango máximo, en días. */
export const CLAVE_RANGO_MAX_DIAS = 'MIS_OPERATIVOS_RANGO_MAX_DIAS';

/** Valor si el parámetro aún no está sembrado (la migración lo siembra con este mismo valor). */
export const RANGO_MAX_DIAS_POR_DEFECTO = 31;

/** Lo que llega en la consulta. `fecha` es la forma anterior, de un solo día. */
export interface ParametrosRango {
  fecha?: string;
  desde?: string;
  hasta?: string;
}

/** Rango resuelto, ambos extremos inclusive. `null` = sin filtro de fecha (forma histórica). */
export interface RangoFechas {
  desde: string;
  hasta: string;
}

/** «2026-10-13» + 1 → «2026-10-14», en UTC para que la fecha de calendario no se desplace. */
export function sumarDiasIso(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias))
    .toISOString()
    .slice(0, 10);
}

/** La fecha del cuadro vigente: mañana en la zona indicada. */
export function fechaVigente(ahora: Date = new Date(), zona?: string): string {
  return sumarDiasIso(fechaIsoEnZona(ahora, zona), 1);
}

/** Días del rango, contando los dos extremos: el mismo día es 1. */
export function diasDelRango(desde: string, hasta: string): number {
  const [a, b] = [desde, hasta].map((texto) => {
    const [anio, mes, dia] = texto.split('-').map(Number);
    return Date.UTC(anio, mes - 1, dia);
  });
  return Math.round((b - a) / 86_400_000) + 1;
}

/** AAAA-MM-DD que existe en el calendario (rechaza 2026-02-30). */
export function esFechaValida(texto: string): boolean {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return false;
  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return (
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia
  );
}

function exigirValida(texto: string, campo: string): void {
  if (!esFechaValida(texto)) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      { [campo]: texto },
    );
  }
}

/**
 * Resuelve el rango pedido. `fecha` sola equivale a desde = hasta = fecha (compatibilidad con
 * la forma de un día). Sin nada, `null`: el listado sin filtro de fecha sigue existiendo.
 */
export function resolverRango(
  parametros: ParametrosRango,
  maxDias: number,
): RangoFechas | null {
  const { fecha, desde, hasta } = parametros;

  if (fecha !== undefined && (desde !== undefined || hasta !== undefined)) {
    throw new ValidacionError(
      'Use «fecha» o el rango «desde»–«hasta», no los dos a la vez.',
      { fecha, desde, hasta },
    );
  }

  if (fecha !== undefined) {
    exigirValida(fecha, 'fecha');
    return { desde: fecha, hasta: fecha };
  }

  if (desde === undefined && hasta === undefined) return null;

  if (desde === undefined || hasta === undefined) {
    throw new ValidacionError(
      'Indique las dos fechas del rango: «desde» y «hasta».',
      { desde, hasta },
    );
  }

  exigirValida(desde, 'desde');
  exigirValida(hasta, 'hasta');

  if (hasta < desde) {
    throw new ValidacionError('"Hasta" no puede ser anterior a "Desde".', {
      desde,
      hasta,
    });
  }

  if (diasDelRango(desde, hasta) > maxDias) {
    throw new ValidacionError(`El rango no puede superar ${maxDias} días.`, {
      desde,
      hasta,
      maxDias,
    });
  }

  return { desde, hasta };
}

/** Lee el parámetro como texto; vacío o inválido cae al valor por defecto. */
export function interpretarRangoMax(texto: string): number {
  const valor = Number(texto);
  return Number.isInteger(valor) && valor >= 1
    ? valor
    : RANGO_MAX_DIAS_POR_DEFECTO;
}

/**
 * Si la fila admite edición: su cuadro no está cerrado, es el cuadro vigente y la ventana de
 * carga está abierta para el usuario. La PROPIEDAD de la fila (si es suya) la sigue
 * decidiendo el cliente, como hasta ahora.
 */
export function admiteEdicion(
  fila: { cuadroFecha: string; cuadroEstado: EstadoCuadro },
  vigente: string,
  ventanaAbierta: boolean,
): boolean {
  return (
    admiteEscritura(fila.cuadroEstado) &&
    fila.cuadroFecha === vigente &&
    ventanaAbierta
  );
}
