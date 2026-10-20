/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · insumo de la orden de movilización
 * Archivo: hoja-ruta.ts
 * Responsabilidad: Ordenar los tramos de un vehículo en un día y describir cada uno para la hoja de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * La ORDEN DE MOVILIZACIÓN oficial (Art. 5, con su número anual) la emite el sistema de órdenes de
 * movilización de la DAF. Aquí solo se arma su INSUMO: todos los tramos del vehículo EN ORDEN de la
 * línea de tiempo (05H00 → 05H00, así un tramo de las 02H00 va al final y no al principio) y la
 * guarda final. Es puro.
 */

import { franjaDe } from './linea-de-tiempo';

export interface TramoDeRuta {
  id: number;
  tipo: string;
  horaInicio: string;
  horaFin: string;
  identificador: string | null;
  descripcion: string | null;
  conductor: string | null;
  origen: string | null;
  destino: string | null;
  /** Unidad que cargó el operativo, en palabras (2026-10-07); null en las tareas. */
  unidad?: string | null;
  unidadCodigo?: string | null;
}

export interface FilaHojaRuta extends TramoDeRuta {
  orden: number;
  /** «Sectores o lugares de movilización», el mismo rótulo de la orden oficial. */
  lugares: string;
}

// Transporte requerido (2026-10-07): los MISMOS nombres que «Planificar el día» (lineaTiempo.util del
// frontend), para que la hoja de ruta y la pantalla de la DAF digan lo mismo.
const NOMBRE_TIPO: Record<string, string> = {
  DEJAR: 'Dejar',
  RETIRAR: 'Retirar',
  COMPLETO: 'Completo',
  TAREA: 'Tarea',
};

export function nombreTipoTramo(tipo: string): string {
  return NOMBRE_TIPO[tipo] ?? tipo;
}

/** Los tramos en el orden de la jornada, numerados, con sus lugares en palabras. */
export function ordenarHojaRuta(
  tramos: readonly TramoDeRuta[],
  inicioJornada: string,
): FilaHojaRuta[] {
  return [...tramos]
    .sort(
      (a, b) =>
        franjaDe(a.horaInicio, a.horaFin, inicioJornada).inicio -
          franjaDe(b.horaInicio, b.horaFin, inicioJornada).inicio ||
        a.id - b.id,
    )
    .map((t, indice) => ({
      ...t,
      orden: indice + 1,
      lugares:
        t.origen && t.destino && t.origen !== t.destino
          ? `${t.origen} → ${t.destino}`
          : (t.destino ?? t.origen ?? '—'),
    }));
}
