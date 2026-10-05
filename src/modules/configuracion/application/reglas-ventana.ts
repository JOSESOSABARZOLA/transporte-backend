/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: reglas-ventana.ts
 * Responsabilidad: Validar una ventana y advertir de sus consecuencias.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * DOS NIVELES, Y LA DIFERENCIA ENTRE ELLOS ES DELIBERADA.
 *
 * RECHAZO. Solo lo que no puede ser: una hora que no es una hora, un día fuera de 1 a
 * 7, una ventana semanal sin día. Son errores de forma, y la base los respalda con
 * `ck_ventana_horas` y `ck_ventana_dias`; aquí se comprueban antes para devolver un
 * mensaje que el administrador entienda en lugar de un error del motor.
 *
 * ADVERTENCIA. Lo que probablemente esté mal pero el negocio no ha fijado. RN-56 dice
 * que la carga departamental cierra y a continuación se abre la de la DAF, y RN-57 que
 * el cuadro debe estar listo a las 16H30. **PV-06 sigue abierto**: las fuentes dan
 * 14H00 en una sesión y 15H00 en otra, del mismo interlocutor. Convertir esas reglas
 * en rechazos impediría a la Dirección ajustar sus horarios mientras la contradicción
 * no se resuelva. Convertirlas en silencio dejaría pasar un cuadro que nadie puede
 * cerrar a tiempo. Se advierte, y decide quien administra.
 */

import {
  TipoVentana,
  type RolDepartamental,
  type VentanaCarga,
} from '@prisma/client';

import {
  aMinutos,
  comoHoraInstitucional,
  esHoraValida,
} from '../../../common/utilidades/hora';

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

  // Sin ninguno de los dos extremos, la ventana no restringe nada. Para eso está
  // `activo = false`, que además lo dice de forma explícita en la pantalla.
  if (
    ventana.activo &&
    ventana.horaApertura === null &&
    ventana.horaCierre === null
  ) {
    return 'Una ventana activa necesita al menos la hora de apertura o la de cierre. Para no restringir el horario de un rol, desactívela.';
  }

  if (ventana.mensajeCierre.trim().length === 0) {
    return 'Indique el mensaje que verá el funcionario cuando la ventana esté cerrada.';
  }

  return undefined;
}

/** Contexto que hace falta para advertir de las consecuencias del cambio. */
export interface ContextoAdvertencia {
  /** Ventanas de los demás roles, tal como están guardadas. */
  otras: VentanaCarga[];
  /** `HORA_LIMITE_CUADRO` de los parámetros de política. */
  limiteCuadro?: string;
}

const ROLES_DEPARTAMENTALES: RolDepartamental[] = [
  'DMIP_OPERATIVOS',
  'DMIP_INSPECCIONES',
  'DMIT_INSTRUCTOR',
] as RolDepartamental[];

const ROL_DAF = 'DAF' as RolDepartamental;

/**
 * Enumera lo que conviene que el administrador sepa antes de guardar.
 *
 * Ninguna de estas advertencias impide el cambio. Todas señalan una incoherencia entre
 * la ventana propuesta y algo que ya está decidido en otro sitio.
 */
export function advertenciasDe(
  ventana: VentanaPropuesta,
  contexto: ContextoAdvertencia,
): string[] {
  const advertencias: string[] = [];

  if (!ventana.activo) {
    advertencias.push(
      `Con la ventana desactivada, el rol ${ventana.rol} podrá escribir a cualquier hora.`,
    );
    return advertencias;
  }

  // RN-56 · la carga de la DAF empieza donde termina la departamental.
  if (ventana.rol === ROL_DAF && ventana.horaApertura) {
    const cierres = contexto.otras
      .filter((otra) => ROLES_DEPARTAMENTALES.includes(otra.rol) && otra.activo)
      .map((otra) => otra.horaCierre)
      .filter((hora): hora is string => hora !== null && esHoraValida(hora));

    const ultimoCierre = cierres.length
      ? cierres.reduce((mayor, hora) =>
          aMinutos(hora) > aMinutos(mayor) ? hora : mayor,
        )
      : undefined;

    if (
      ultimoCierre &&
      aMinutos(ventana.horaApertura) < aMinutos(ultimoCierre)
    ) {
      advertencias.push(
        `RN-56. La carga de Transportes abriría a las ${comoHoraInstitucional(ventana.horaApertura)}, antes de que cierre la departamental a las ${comoHoraInstitucional(ultimoCierre)}. Ambas quedarían abiertas a la vez.`,
      );
    }
  }

  // RN-57 · el cuadro debe estar cerrado y disponible a la hora límite.
  if (ventana.rol === ROL_DAF && ventana.horaCierre && contexto.limiteCuadro) {
    if (aMinutos(ventana.horaCierre) > aMinutos(contexto.limiteCuadro)) {
      advertencias.push(
        `RN-57. La carga de Transportes cerraría a las ${comoHoraInstitucional(ventana.horaCierre)}, después de la hora límite del cuadro (${comoHoraInstitucional(contexto.limiteCuadro)}).`,
      );
    }
  }

  /*
    ═══════════════════════════════════════════════════════════════════════════════
    AQUÍ HABÍA UN AVISO DE COHERENCIA, Y SE FUE CON LO QUE LO CAUSABA. 2026-08-25.

    Decía: «El parámetro HORA_CIERRE_DEPARTAMENTAL dice 15H00 y esta ventana diría 16H00.
    Son dos formas de guardar el mismo dato: conviene cambiar también el parámetro.»

    Era cierto, y ese es justamente el problema: **el dato estaba dos veces**. Quien movía
    la hora en la ventana tenía que acordarse de moverla también en los parámetros, y el
    sistema solo podía pedírselo por favor —la advertencia no impedía nada—.

    `HORA_CIERRE_DEPARTAMENTAL` se retiró. La hora de cierre vive **solo en
    `t_ventana_carga`**, que es la que gobierna: `VentanaCargaGuard` lee esa tabla y
    ninguna otra. El parámetro no decidía nada; solo alimentaba este aviso.

    Y es lo que pide RF-059: «parametrizar las ventanas de carga **por rol**». Un valor
    único no puede expresar que la DAF cierre a las 16H30 y los departamentos a las 15H00,
    ni que mañana dos departamentos difieran.

    `HORA_LIMITE_CUADRO` **se queda**: expresa otro hecho —cuándo debe estar cerrado el
    cuadro (RN-57)— y sí gobierna la comprobación de arriba.
    ═══════════════════════════════════════════════════════════════════════════════
  */

  return advertencias;
}
