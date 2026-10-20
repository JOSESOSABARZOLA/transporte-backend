/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: horario-ventana.ts
 * Responsabilidad: Componer UN horario de ventana a partir de las horas reales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL HORARIO SE CALCULA DE LAS HORAS, NO SE ESCRIBE A MANO. 2026-10-06.
 *
 * El bug: la lista «Antes de asignar» decía «la ventana abre a las 18H25» —las horas reales de
 * `t_ventana_carga`— y el banner decía «15H00 a 16H30», que era `vcar_mensaje_cierre`: un TEXTO
 * LIBRE escrito cuando las horas eran otras. Al mover las horas en «Ventanas y parámetros» el texto
 * no se movía con ellas, y la pantalla mostraba dos horarios contradictorios.
 *
 * Desde aquí, todo lo que el sistema DICE de una ventana —el estado de la cabecera, el 423 de la
 * guarda— sale de estas funciones, que solo leen las horas. El texto libre del administrador se
 * conserva, pero aparte (`notaAdministrador`), nunca como el horario.
 *
 * RN-56: la carga de la DAF empieza cuando termina la departamental. Aquí solo se usa para
 * EXPLICAR la apertura de la DAF (`motivoApertura`). Ya no es un error de configuración que
 * impida guardar (2026-10-08): la pantalla solo parametriza; la coherencia entre ventanas la
 * aplica el sistema en ejecución.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { RolDepartamental } from '@prisma/client';

import { comoHoraInstitucional } from '../../utilidades/hora';
import {
  detectarHoraInconsistente,
  resolverMensajeVentana,
} from './mensaje-ventana';

/** Lo que estas funciones necesitan de una ventana (un `VentanaCarga` o una propuesta). */
export interface VentanaHoraria {
  rol: RolDepartamental;
  horaApertura: string | null;
  horaCierre: string | null;
  diaApertura: number | null;
  diaCierre: number | null;
  activo: boolean;
}

/** Lo que el mensaje para el funcionario necesita además del horario (2026-10-07). */
export interface VentanaConMensaje extends VentanaHoraria {
  mensajeCierre: string;
}

/** Los tres departamentos que REGISTRAN operativos; su cierre abre la ventana de la DAF. */
export const ROLES_DE_REGISTRO = [
  'DMIP_OPERATIVOS',
  'DMIP_INSPECCIONES',
  'DMIT_INSTRUCTOR',
] as RolDepartamental[];

/** El rol cuya ventana es la de asignación de transporte. */
export const ROL_TRANSPORTE = 'DAF' as RolDepartamental;

/** El motivo de la apertura de la DAF, cuando coincide con el cierre del registro (RN-56). */
export const MOTIVO_APERTURA_TRAS_REGISTRO =
  'cuando cierra el registro de operativos';

/** Un horario ya redactado, con el motivo de la apertura si lo hay. */
export interface HorarioVentana {
  texto: string;
  motivoApertura: string | null;
}

const MINUTOS_POR_DIA = 24 * 60;

function aMinutos(hora: string): number {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
}

const usaDias = (ventana: VentanaHoraria): boolean =>
  ventana.diaApertura !== null || ventana.diaCierre !== null;

/** El sujeto de la frase según el rol: la DAF asigna transporte; el resto, carga. */
function sujeto(rol: RolDepartamental): string {
  if (rol === ROL_TRANSPORTE) return 'La ventana de asignación de transporte';
  if (ROLES_DE_REGISTRO.includes(rol))
    return 'La ventana de carga de su departamento';
  return 'La ventana de carga';
}

/**
 * La hora del ÚLTIMO cierre del registro de operativos (entre las ventanas activas de los tres
 * departamentos), o `null` si ninguna cierra a una hora fija.
 */
export function ultimoCierreDeRegistro(
  ventanas: readonly VentanaHoraria[],
): string | null {
  const cierres = ventanas
    .filter(
      (ventana) =>
        ventana.activo &&
        ROLES_DE_REGISTRO.includes(ventana.rol) &&
        ventana.horaCierre !== null,
    )
    .map((ventana) => ventana.horaCierre as string);

  if (cierres.length === 0) return null;
  return cierres.reduce((mayor, hora) =>
    aMinutos(hora) > aMinutos(mayor) ? hora : mayor,
  );
}

/** El motivo de la apertura: solo la DAF, y solo si abre justo cuando cierra el registro. */
function motivoDeApertura(
  ventana: VentanaHoraria,
  ventanas: readonly VentanaHoraria[],
): string | null {
  if (ventana.rol !== ROL_TRANSPORTE || ventana.horaApertura === null)
    return null;
  const cierreRegistro = ultimoCierreDeRegistro(ventanas);
  return cierreRegistro !== null &&
    aMinutos(cierreRegistro) === aMinutos(ventana.horaApertura)
    ? MOTIVO_APERTURA_TRAS_REGISTRO
    : null;
}

/**
 * El horario de una ventana en UNA frase, compuesta solo de sus horas reales.
 *
 *   · DAF tras el registro → «La ventana de asignación de transporte abre a las 18H25, cuando
 *     cierra el registro de operativos, y cierra a las 18H28.»
 *   · Departamento         → «La ventana de carga de su departamento cierra a las 18H25.»
 *   · Sin ventana / inactiva → «Sin restricción horaria.»
 */
export function horarioDeVentana(
  ventana: VentanaHoraria | null,
  ventanas: readonly VentanaHoraria[],
): HorarioVentana {
  if (!ventana || !ventana.activo) {
    return { texto: 'Sin restricción horaria.', motivoApertura: null };
  }

  const motivo = motivoDeApertura(ventana, ventanas);
  const quien = sujeto(ventana.rol);
  const apertura =
    ventana.horaApertura !== null
      ? comoHoraInstitucional(ventana.horaApertura)
      : null;
  const cierre =
    ventana.horaCierre !== null
      ? comoHoraInstitucional(ventana.horaCierre)
      : null;

  if (apertura !== null && cierre !== null) {
    return {
      texto: motivo
        ? `${quien} abre a las ${apertura}, ${motivo}, y cierra a las ${cierre}.`
        : `${quien} abre a las ${apertura} y cierra a las ${cierre}.`,
      motivoApertura: motivo,
    };
  }
  if (apertura !== null) {
    return {
      texto: motivo
        ? `${quien} abre a las ${apertura}, ${motivo}.`
        : `${quien} abre a las ${apertura}.`,
      motivoApertura: motivo,
    };
  }
  if (cierre !== null) {
    return { texto: `${quien} cierra a las ${cierre}.`, motivoApertura: null };
  }
  return { texto: 'Sin restricción horaria.', motivoApertura: null };
}

/**
 * El mensaje de una ventana CERRADA en un momento dado (minutos del día en su zona): antes de
 * abrir se dice cuándo abre; después de cerrar, que cerró y cuándo vuelve. Lo usan el estado de la
 * cabecera y el 423 de la guarda.
 *
 * Una ventana por DÍAS (semanal) no se redacta: su apertura depende del día, no solo de la hora,
 * y adivinarla daría un aviso falso. Ahí manda el texto del administrador (`mensajeRespaldo`).
 */
export function mensajeDeVentanaCerrada(
  ventana: VentanaHoraria,
  ventanas: readonly VentanaHoraria[],
  minutosActuales: number,
  mensajeRespaldo: string,
): string {
  if (usaDias(ventana)) return mensajeRespaldo;

  const horario = horarioDeVentana(ventana, ventanas);
  const { horaApertura, horaCierre } = ventana;
  if (horaApertura === null && horaCierre === null) return horario.texto;

  // ¿Antes de abrir o después de cerrar? Con las dos horas y sin cruzar la medianoche, lo dice
  // la hora actual; una ventana nocturna cerrada está siempre «antes» de su próxima apertura.
  const antes =
    horaApertura !== null &&
    (horaCierre === null ||
      aMinutos(horaApertura) > aMinutos(horaCierre) ||
      minutosActuales < aMinutos(horaApertura));

  if (antes) return horario.texto;

  const quien = sujeto(ventana.rol);
  const cierre = comoHoraInstitucional(horaCierre as string);
  if (horaApertura === null) {
    return `${quien} cerró a las ${cierre}. Vuelve a abrirse mañana.`;
  }
  const apertura = comoHoraInstitucional(horaApertura);
  return horario.motivoApertura
    ? `${quien} cerró a las ${cierre}. Vuelve a abrirse mañana a las ${apertura}, ${horario.motivoApertura}.`
    : `${quien} cerró a las ${cierre}. Vuelve a abrirse mañana a las ${apertura}.`;
}

/** Minutos del día actual en una zona horaria (para `mensajeDeVentanaCerrada`). */
export function minutosDelDia(hora: string): number {
  return aMinutos(hora) % MINUTOS_POR_DIA;
}

/**
 * EL MENSAJE QUE VE EL FUNCIONARIO con la ventana cerrada (2026-10-07). Lo usan el 423 de la
 * guarda y el estado de la cabecera, para que digan lo mismo.
 *
 *   · Sábado o domingo en una ventana LABORABLE → que solo abre de lunes a viernes.
 *   · El mensaje del administrador, con `{cierre}` / `{apertura}` ya resueltos.
 *   · PERO si ese mensaje tiene una hora FIJA que no coincide con la ventana (el caso de un texto
 *     que se quedó atrás al mover la hora), se usa el mensaje calculado de las horas reales: el
 *     funcionario nunca debe leer una hora que no es. La pantalla de administración lo avisa.
 *   · Sin mensaje, el calculado de siempre (`mensajeDeVentanaCerrada`).
 */
export function mensajeParaFuncionario(
  ventana: VentanaConMensaje,
  ventanas: readonly VentanaHoraria[],
  minutosActuales: number,
  finDeSemana = false,
): string {
  if (finDeSemana) {
    return `${sujeto(ventana.rol)} solo abre de lunes a viernes. Vuelve a abrirse el lunes.`;
  }

  const texto = ventana.mensajeCierre.trim();
  if (
    texto.length > 0 &&
    detectarHoraInconsistente(
      texto,
      ventana.horaApertura,
      ventana.horaCierre,
    ) === null
  ) {
    return resolverMensajeVentana(
      texto,
      ventana.horaApertura,
      ventana.horaCierre,
    );
  }

  return mensajeDeVentanaCerrada(
    ventana,
    ventanas,
    minutosActuales,
    resolverMensajeVentana(texto, ventana.horaApertura, ventana.horaCierre),
  );
}
