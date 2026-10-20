/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: reglas-ventana.ts
 * Responsabilidad: Validar la forma de una ventana antes de guardarla.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * SOLO LA PROPIA VENTANA. Se rechaza lo que no puede ser: una hora que no es una hora, un
 * día fuera de 1 a 7, una ventana semanal sin día, un cierre que no es posterior a la apertura o
 * un mensaje vacío. Son errores de forma, y la base los respalda con `ck_ventana_horas` y
 * `ck_ventana_dias`; aquí se comprueban antes para devolver un mensaje que el administrador
 * entienda en lugar de un error del motor.
 *
 * NO SE COMPARA CON OTRAS VENTANAS (2026-10-08). La pantalla solo parametriza; la coherencia
 * entre ventanas la aplica el sistema en ejecución (`VentanaCargaGuard` y el flujo del cuadro),
 * no al guardar. Aquí vivía `advertenciasDe` —RN-56: la DAF abre cuando cierra la carga
 * departamental; RN-57: el cuadro listo a la `HORA_LIMITE_CUADRO`—, y se retiró con ese
 * criterio, igual que el rechazo RN-56 que se había añadido el 2026-10-06.
 */

import { TipoVentana, type RolDepartamental } from '@prisma/client';

import { aMinutos, esHoraValida } from '../../../common/utilidades/hora';

/** Estado propuesto para una ventana, ya combinado con lo que había. */
export interface VentanaPropuesta {
  rol: RolDepartamental;
  tipo: TipoVentana;
  diaApertura: number | null;
  horaApertura: string | null;
  diaCierre: number | null;
  horaCierre: string | null;
  mensajeCierre: string;
  activo: boolean;
}

const DIA_MINIMO = 1;
const DIA_MAXIMO = 7;

/**
 * Comprueba la forma de la ventana propuesta.
 * @returns el motivo del rechazo, o `undefined` si es admisible.
 */
export function motivoDeRechazo(ventana: VentanaPropuesta): string | undefined {
  const horaMal = [
    { valor: ventana.horaApertura, nombre: 'apertura' },
    { valor: ventana.horaCierre, nombre: 'cierre' },
  ].find(({ valor }) => valor !== null && !esHoraValida(valor));

  if (horaMal) {
    return `La hora de ${horaMal.nombre} se escribe en formato HH:MM, de 00:00 a 23:59. Recibido: «${horaMal.valor ?? ''}».`;
  }

  const diaMal = [
    { valor: ventana.diaApertura, nombre: 'apertura' },
    { valor: ventana.diaCierre, nombre: 'cierre' },
  ].find(
    ({ valor }) =>
      valor !== null &&
      (!Number.isInteger(valor) || valor < DIA_MINIMO || valor > DIA_MAXIMO),
  );

  if (diaMal) {
    return `El día de ${diaMal.nombre} se indica de 1 a 7, donde 1 es lunes y 7 es domingo.`;
  }

  // Una ventana semanal sin días es una ventana diaria mal declarada: el evaluador la
  // trataría como tal y el administrador creería haber configurado otra cosa.
  if (
    ventana.tipo === TipoVentana.SEMANAL &&
    (ventana.diaApertura === null || ventana.diaCierre === null)
  ) {
    return 'Una ventana semanal necesita el día de apertura y el de cierre. Si no dependen del día de la semana, use el tipo DIARIO.';
  }

  // «Sin restricción» no usa horas ni mensaje (2026-10-07): no hay nada más que comprobar.
  if (ventana.tipo === TipoVentana.SIN_RESTRICCION) return undefined;

  // Una ventana que restringe necesita su cierre. Para no restringir está el tipo
  // SIN_RESTRICCION, que lo dice de forma explícita en la pantalla.
  if (ventana.horaCierre === null) {
    return 'Indique la hora de cierre.';
  }

  // La apertura, si la hay, va antes del cierre. Las ventanas por días (semanales heredadas)
  // no se comparan así: su apertura depende del día, no solo de la hora.
  const usaDias = ventana.diaApertura !== null || ventana.diaCierre !== null;
  if (
    !usaDias &&
    ventana.horaApertura !== null &&
    aMinutos(ventana.horaApertura) >= aMinutos(ventana.horaCierre)
  ) {
    return 'La hora de cierre debe ser posterior a la de apertura.';
  }

  if (ventana.mensajeCierre.trim().length === 0) {
    return 'Indique el mensaje que verá el funcionario cuando la ventana esté cerrada.';
  }

  return undefined;
}
