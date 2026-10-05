/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: ventana-carga.evaluador.ts
 * Responsabilidad: Decidir si un rol puede escribir en un momento dado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * RN-56 y RN-59. Es la política POL-05 del análisis de dominio.
 *
 * Se evalúa SIEMPRE en la zona horaria declarada en la ventana, no en la del
 * servidor. Contempla el cruce de medianoche por el mismo motivo que RangoHorario:
 * una ventana de 20H00 a 05H00 tiene hora de cierre MENOR que la de apertura, y
 * compararlas sin contemplarlo da resultados silenciosamente incorrectos.
 *
 * Se expone como clase propia y no como método privado de la guarda para que el
 * `VentanaCargaService` del submódulo `configuracion` (M-08) la reutilice en lugar
 * de reimplementarla.
 */

import { Injectable } from '@nestjs/common';
import type { VentanaCarga } from '@prisma/client';

import { diaIsoEnZona, horaEnZona } from '../../utilidades/marca-tiempo';

export interface VeredictoVentana {
  puedeEscribir: boolean;
  /** Mensaje redactado para el funcionario, tomado de la ventana. */
  motivo?: string;
  horaCierre?: string;
  horaApertura?: string;
}

const MINUTOS_POR_DIA = 24 * 60;

@Injectable()
export class VentanaCargaEvaluador {
  evaluar(
    ventana: VentanaCarga | null,
    momento = new Date(),
  ): VeredictoVentana {
    // Sin ventana configurada, o desactivada, no hay restricción horaria.
    if (!ventana || !ventana.activo) {
      return { puedeEscribir: true };
    }

    const zona = ventana.zonaHoraria;
    const hora = horaEnZona(momento, zona);
    const dia = diaIsoEnZona(momento, zona);

    const usaDias = ventana.diaApertura !== null && ventana.diaCierre !== null;

    const actual = usaDias
      ? (dia - 1) * MINUTOS_POR_DIA + aMinutos(hora)
      : aMinutos(hora);

    const apertura = componer(
      ventana.horaApertura,
      usaDias ? ventana.diaApertura : null,
    );
    const cierre = componer(
      ventana.horaCierre,
      usaDias ? ventana.diaCierre : null,
    );

    const dentro = estaDentro(actual, apertura, cierre);

    if (dentro) {
      return {
        puedeEscribir: true,
        horaCierre: ventana.horaCierre ?? undefined,
      };
    }

    return {
      puedeEscribir: false,
      motivo: ventana.mensajeCierre,
      horaCierre: ventana.horaCierre ?? undefined,
      horaApertura: ventana.horaApertura ?? undefined,
    };
  }
}

/** Convierte `HH:MM` a minutos desde medianoche. */
function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

/** Compone el instante de la ventana en minutos, con día si la ventana lo usa. */
function componer(hora: string | null, dia: number | null): number | null {
  if (hora === null) return null;
  const minutos = aMinutos(hora);
  return dia === null ? minutos : (dia - 1) * MINUTOS_POR_DIA + minutos;
}

/**
 * Comprueba si el momento cae dentro del intervalo, contemplando que el cierre
 * pueda ser anterior a la apertura, es decir que la ventana cruce la medianoche o
 * el fin de semana.
 */
function estaDentro(
  actual: number,
  apertura: number | null,
  cierre: number | null,
): boolean {
  if (apertura === null && cierre === null) return true;
  if (apertura === null) return actual < (cierre as number);
  if (cierre === null) return actual >= apertura;

  return apertura <= cierre
    ? actual >= apertura && actual < cierre
    : actual >= apertura || actual < cierre;
}
