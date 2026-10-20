/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (paso 4)
 * Archivo: hoja-ruta-emision.ts
 * Responsabilidad: Calcular la huella de los tramos de un conductor y el estado de su hoja de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * «SI SE CAMBIA UNA ASIGNACIÓN DESPUÉS DE EMITIR, LA HOJA VUELVE A PENDIENTE.»
 *
 * No se guarda una copia del PDF (se sigue generando al momento). Al emitir se guarda la HUELLA de
 * los tramos del conductor: un SHA-256 de lo que la hoja imprime —tramo, tipo, horas, vehículo y si
 * comparte—, en orden estable. Mientras la huella actual sea la guardada, la hoja está EMITIDA; si
 * difiere (se asignó, quitó o cambió un tramo), está PENDIENTE_CAMBIO. Sin emisión, PENDIENTE.
 *
 * ES PURA: el hash es determinista; no hay base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'node:crypto';

export type EstadoHojaRuta = 'PENDIENTE' | 'EMITIDA' | 'PENDIENTE_CAMBIO';

/** Lo que de un tramo entra en la huella. */
export interface TramoDeHuella {
  id: number;
  tipo: string;
  horaInicio: string;
  horaFin: string;
  vehiculoId: number | null;
  compartidoConTramoId: number | null;
}

/** Huella de los tramos de un conductor: no depende del orden en que lleguen. */
export function huellaDeTramos(tramos: readonly TramoDeHuella[]): string {
  const canonico = [...tramos]
    .sort((a, b) => a.id - b.id)
    .map(
      (t) =>
        `${t.id}|${t.tipo}|${t.horaInicio}|${t.horaFin}|${t.vehiculoId ?? ''}|${t.compartidoConTramoId ?? ''}`,
    )
    .join(';');
  return createHash('sha256').update(canonico).digest('hex');
}

export function estadoHojaRuta(
  huellaActual: string,
  emision: { huella: string } | null,
): EstadoHojaRuta {
  if (!emision) return 'PENDIENTE';
  return emision.huella === huellaActual ? 'EMITIDA' : 'PENDIENTE_CAMBIO';
}
