/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · tramos de un operativo
 * Archivo: plan-tramos.ts
 * Responsabilidad: Decidir QUÉ tramos de transporte pide un operativo según su tipo de transporte.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO TODO OPERATIVO NECESITA AL CONDUCTOR TODO EL TIEMPO. Los PMO solo piden «dejar» al funcionario,
 * «retirarlo» o ambos; entre medio el conductor queda LIBRE y puede encadenar otro operativo. Por eso
 * la asignación se hace por TRAMO y no por operativo entero:
 *
 *   · COMPLETO      → un tramo de inicio a fin (el conductor acompaña todo el operativo).
 *   · SOLO_INICIO   → DEJAR: desde el inicio, DAF_DURACION_DEJAR_MIN minutos.
 *   · SOLO_FIN      → RETIRAR: los últimos DAF_DURACION_RETIRAR_MIN minutos.
 *   · INICIO_Y_FIN  → DEJAR + RETIRAR. Si el operativo es tan corto que se pisan, un solo COMPLETO.
 *   · PROPIOS_MEDIOS → ninguno.
 *
 * Las duraciones son parámetros (regla 2), una por tipo de tramo desde el 2026-10-14 (decisión
 * D7); si alguna no está configurada vale DAF_DURACION_TRAMO_MIN. NO se calculan con la matriz de
 * traslados: el tramo empieza y termina en la zonal del operativo, así que la matriz daría siempre
 * «misma zonal» y el viaje desde donde viene el conductor —que ya mide `NO_LLEGA` entre tramos—
 * se contaría dos veces. Un tramo nunca se sale del operativo. Las horas se devuelven como HH:MM
 * con su `cruzaMedianoche`, igual que el operativo.
 *
 * ES PURA.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { aHora, aMinutos, MINUTOS_DIA } from './linea-de-tiempo';

export type TipoTransportePlan =
  | 'COMPLETO'
  | 'SOLO_INICIO'
  | 'SOLO_FIN'
  | 'INICIO_Y_FIN'
  | 'PROPIOS_MEDIOS';

export type TipoTramoPlan = 'DEJAR' | 'RETIRAR' | 'COMPLETO';

export interface OperativoAPlanificar {
  horaInicio: string;
  horaFin: string;
  tipoTransporte: TipoTransportePlan;
  /** Zonal del operativo (la primera, si tiene varias), o `null` si no se sabe. */
  zonalId: number | null;
}

/** Minutos de cada tipo de tramo corto (DAF_DURACION_DEJAR_MIN / _RETIRAR_MIN). */
export interface DuracionesTramo {
  dejar: number;
  retirar: number;
}

export interface TramoPlanificado {
  tipo: TipoTramoPlan;
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  zonalOrigenId: number | null;
  zonalDestinoId: number | null;
}

/** Los tramos que pide el operativo. Ver la tabla en la cabecera. */
export function planificarTramos(
  operativo: OperativoAPlanificar,
  duraciones: DuracionesTramo,
): TramoPlanificado[] {
  if (operativo.tipoTransporte === 'PROPIOS_MEDIOS') return [];

  const inicio = aMinutos(operativo.horaInicio);
  let fin = aMinutos(operativo.horaFin);
  if (fin <= inicio) fin += MINUTOS_DIA;
  const acotar = (minutos: number): number =>
    Math.max(1, Math.min(minutos, fin - inicio));
  const dejar = acotar(duraciones.dejar);
  const retirar = acotar(duraciones.retirar);

  const tramo = (
    tipo: TipoTramoPlan,
    desde: number,
    hasta: number,
  ): TramoPlanificado => ({
    tipo,
    horaInicio: aHora(desde),
    horaFin: aHora(hasta),
    cruzaMedianoche: hasta >= MINUTOS_DIA && desde < MINUTOS_DIA,
    zonalOrigenId: operativo.zonalId,
    zonalDestinoId: operativo.zonalId,
  });

  switch (operativo.tipoTransporte) {
    case 'SOLO_INICIO':
      return [tramo('DEJAR', inicio, inicio + dejar)];
    case 'SOLO_FIN':
      return [tramo('RETIRAR', fin - retirar, fin)];
    case 'INICIO_Y_FIN':
      // Si el operativo es tan corto que dejar y retirar se pisan, el conductor no alcanza a irse:
      // es un solo tramo completo.
      if (fin - inicio <= dejar + retirar)
        return [tramo('COMPLETO', inicio, fin)];
      return [
        tramo('DEJAR', inicio, inicio + dejar),
        tramo('RETIRAR', fin - retirar, fin),
      ];
    default:
      return [tramo('COMPLETO', inicio, fin)];
  }
}
