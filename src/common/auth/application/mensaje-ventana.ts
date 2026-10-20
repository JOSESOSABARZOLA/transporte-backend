/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: mensaje-ventana.ts
 * Responsabilidad: Resolver los marcadores del mensaje de una ventana y detectar horas fijas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * EL MENSAJE QUE ESCRIBE EL ADMINISTRADOR LLEVA MARCADORES, NO HORAS. `{cierre}` y `{apertura}`
 * se reemplazan por la hora configurada en formato institucional (19H25), así el texto sigue a la
 * hora cuando alguien la mueve. Era el defecto de siempre: la hora cambiaba en la ventana y el
 * texto libre seguía diciendo la anterior.
 *
 * Funciones PURAS, sin dependencias: las usan la guarda (423), el estado de la cabecera y la
 * pantalla de administración. El frontend tiene una copia con las MISMAS pruebas
 * (`utils/mensajeVentana.util.ts`): el modal las necesita en vivo, sin ir al servidor.
 */

import { comoHoraInstitucional } from '../../utilidades/hora';

/** Marcador de la hora de cierre. */
export const MARCADOR_CIERRE = '{cierre}';
/** Marcador de la hora de apertura. */
export const MARCADOR_APERTURA = '{apertura}';

/** Apertura vacía = se puede cargar desde el inicio del día. */
const INICIO_DEL_DIA = '00:00';

/** Una hora escrita en el texto: «18H25», «18h25» o «18:25» (con o sin cero inicial). */
const PATRON_HORA_FIJA =
  /(?<![0-9])((?:[01]?[0-9]|2[0-3]))[Hh:]([0-5][0-9])(?![0-9])/g;

/**
 * El mensaje con los marcadores reemplazados por las horas reales.
 *
 *   · `{cierre}`   → la hora de cierre (19H25). Sin cierre, el marcador se quita.
 *   · `{apertura}` → la hora de apertura; sin apertura, 00H00 (se carga desde el inicio del día).
 */
export function resolverMensajeVentana(
  mensaje: string,
  apertura: string | null,
  cierre: string | null,
): string {
  const textoCierre = cierre === null ? '' : comoHoraInstitucional(cierre);
  const textoApertura = comoHoraInstitucional(apertura ?? INICIO_DEL_DIA);
  return mensaje
    .split(MARCADOR_CIERRE)
    .join(textoCierre)
    .split(MARCADOR_APERTURA)
    .join(textoApertura);
}

/** Una hora fija del mensaje que no coincide con la ventana. */
export interface HoraInconsistente {
  /** Tal como está escrita en el mensaje («18H25», «18:25»). */
  texto: string;
  /** Normalizada a `HH:MM`. */
  hora: string;
}

/** `9:05` → `09:05`, para comparar con las horas de la ventana. */
function normalizar(horas: string, minutos: string): string {
  return `${horas.padStart(2, '0')}:${minutos}`;
}

/**
 * La PRIMERA hora fija del mensaje que no es ni la de apertura ni la de cierre, o `null` si el
 * mensaje no tiene horas fijas o todas coinciden. Es el aviso «El mensaje dice 18H25 pero la hora
 * de cierre es 19H25».
 */
export function detectarHoraInconsistente(
  mensaje: string,
  apertura: string | null,
  cierre: string | null,
): HoraInconsistente | null {
  for (const coincidencia of mensaje.matchAll(PATRON_HORA_FIJA)) {
    const hora = normalizar(coincidencia[1], coincidencia[2]);
    if (hora !== apertura && hora !== cierre) {
      return { texto: coincidencia[0], hora };
    }
  }
  return null;
}
