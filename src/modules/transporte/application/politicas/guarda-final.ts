/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · fin del día
 * Archivo: guarda-final.ts
 * Responsabilidad: Sugerir dónde queda cada vehículo al cerrar el día y quién lo toma mañana.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA GUARDA FINAL DECIDE CÓMO EMPIEZA MAÑANA (reunión DAF). Si el vehículo queda en Calderón, lo
 * recoge un conductor del norte; si el conductor tiene parqueadero autorizado, se lo lleva y al día
 * siguiente repite vehículo.
 *
 * REGLA (Art. 8 del Reglamento: el vehículo pernocta en un garaje autorizado o, con acta, en el
 * domicilio del conductor). Desde el 2026-10-08 («Planificar el día», paso 3):
 *   · Se sugiere SIEMPRE el garaje autorizado más cercano a su ÚLTIMO PUNTO (la zonal del último
 *     operativo). La DAF cambia solo las excepciones.
 *   · El domicilio (parqueadero con acta) ya NO se sugiere: es una excepción que la DAF elige a
 *     mano, y al guardarla escribe el número de acta, que se valida contra la vigente del conductor.
 *   · `tarde` (a partir de GUARDA_HORA_TARDE) se sigue informando, pero ya no cambia la sugerencia.
 *     Antes, terminar tarde con acta vigente sugería el domicilio, y sin acta el garaje más cercano
 *     al sector del domicilio del conductor.
 *   «Más cercano» = menor traslado según la misma regla de `traslados.ts`; empate, por nombre.
 *
 * CONTINUIDAD: «mismo conductor y vehículo» si se lo lleva a casa o si mañana tiene turno; si no,
 * «mañana lo toma un conductor del sector X», con X el sector donde queda.
 *
 * ES PURA.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  minutosTraslado,
  type Lugar,
  type ParametrosTraslado,
  type TablaTraslados,
} from './traslados';

export interface Garaje {
  ubicacionId: number;
  nombre: string;
  lugar: Lugar;
}

export interface VehiculoAlCierre {
  vehiculoId: number;
  placa: string;
  /** Fin del último tramo del día, en minutos de la línea de tiempo. */
  ultimoFin: number;
  /** Dónde terminó su último tramo. */
  ultimoPunto: Lugar | null;
  conductor: {
    id: number;
    nombre: string;
    sector: string | null;
    actaVigente: boolean;
  } | null;
  /** ¿El mismo conductor tiene turno (no libre) mañana? */
  conductorTrabajaManana: boolean;
}

export interface ParametrosGuarda {
  /** GUARDA_HORA_TARDE en minutos de la línea de tiempo. */
  horaTarde: number;
  tabla: TablaTraslados;
  traslado: ParametrosTraslado;
}

export interface GuardaSugerida {
  vehiculoId: number;
  placa: string;
  tipo: 'GARAJE' | 'DOMICILIO';
  ubicacionId: number | null;
  ubicacion: string | null;
  conductorId: number | null;
  tarde: boolean;
  motivo: string;
  continuidad: string;
}

/** El garaje autorizado más cercano a un lugar (o `null` si no hay garajes). */
export function garajeMasCercano(
  desde: Lugar | null,
  garajes: readonly Garaje[],
  parametros: ParametrosGuarda,
): Garaje | null {
  if (garajes.length === 0) return null;
  return [...garajes].sort(
    (a, b) =>
      minutosTraslado(desde, a.lugar, parametros.tabla, parametros.traslado) -
        minutosTraslado(
          desde,
          b.lugar,
          parametros.tabla,
          parametros.traslado,
        ) || a.nombre.localeCompare(b.nombre),
  )[0];
}

export function sugerirGuarda(
  vehiculo: VehiculoAlCierre,
  garajes: readonly Garaje[],
  parametros: ParametrosGuarda,
): GuardaSugerida {
  const tarde = vehiculo.ultimoFin >= parametros.horaTarde;
  const garaje = garajeMasCercano(vehiculo.ultimoPunto, garajes, parametros);
  const continuidad = vehiculo.conductorTrabajaManana
    ? 'Mañana: mismo conductor y vehículo.'
    : `Mañana lo toma un conductor del sector ${garaje?.lugar.sector ?? 'donde queda'}.`;

  return {
    vehiculoId: vehiculo.vehiculoId,
    placa: vehiculo.placa,
    tarde,
    tipo: 'GARAJE',
    ubicacionId: garaje?.ubicacionId ?? null,
    ubicacion: garaje?.nombre ?? null,
    conductorId: vehiculo.conductor?.id ?? null,
    motivo: garaje
      ? 'Garaje autorizado más cercano a su último operativo.'
      : 'No hay garajes autorizados registrados: indique dónde queda.',
    continuidad,
  };
}
