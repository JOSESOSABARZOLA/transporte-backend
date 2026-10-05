/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: reglas-parametro.ts
 * Responsabilidad: Validar que el valor de un parámetro es admisible.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Dos capas de validación, y ninguna inventa nada:
 *
 * 1. RANGO. Los tipos numéricos se comparan con `para_minimo` y `para_maximo`, que
 *    están en la propia fila. La base los respalda con `ck_parametro_rango`; esto
 *    los verifica antes, para poder devolver un mensaje que el administrador entienda
 *    en lugar de un error del motor.
 *
 * 2. DOMINIO. Tres parámetros tienen forma acotada declarada en
 *    docs/IMPLEMENTATION_GUIDE.md §5.2: el período de cómputo admite tres valores, y
 *    las horas se escriben `HH:MM`. No es una regla inferida: sin ese formato, el
 *    evaluador de ventanas no puede leerlas y los cierres dejarían de funcionar.
 */

import { TipoParametro, type ParametroPolitica } from '@prisma/client';

/** Períodos admitidos para el cómputo del tope de salidas pesadas. RN-37. */
export const PERIODOS_COMPUTO = ['SEMANAL', 'QUINCENAL', 'MENSUAL'];

const PATRON_HORA = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Parámetros de texto cuyo contenido tiene forma acotada. */
const DOMINIO_TEXTO: Record<
  string,
  { valido: (valor: string) => boolean; mensaje: string }
> = {
  PERIODO_COMPUTO_SALIDAS: {
    valido: (valor) => PERIODOS_COMPUTO.includes(valor),
    mensaje: `El período de cómputo admite estos valores: ${PERIODOS_COMPUTO.join(', ')}.`,
  },
  HORA_LIMITE_CUADRO: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje: 'La hora límite se escribe en formato HH:MM, por ejemplo 16:30.',
  },
  FRANJA_NOCTURNA_INICIO: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje: 'El inicio de la franja nocturna se escribe en formato HH:MM.',
  },
  FRANJA_NOCTURNA_FIN: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje: 'El fin de la franja nocturna se escribe en formato HH:MM.',
  },
  // Cobertura por turnos (Instrucción): las ventanas de los turnos diurno y nocturno.
  // El horario del operativo al asignar debe caer dentro de la ventana de su turno.
  HORA_TURNO_DIURNO_INICIO: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El inicio del turno diurno se escribe en formato HH:MM, por ejemplo 08:00.',
  },
  HORA_TURNO_DIURNO_FIN: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El fin del turno diurno se escribe en formato HH:MM, por ejemplo 16:30.',
  },
  HORA_TURNO_NOCTURNO_INICIO: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El inicio del turno nocturno se escribe en formato HH:MM, por ejemplo 17:30.',
  },
  HORA_TURNO_NOCTURNO_FIN: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El fin del turno nocturno se escribe en formato HH:MM, por ejemplo 02:00.',
  },
  // Jornada del personal de NOMBRAMIENTO (RN-26): fuera de esta ventana no se le asigna.
  HORA_NOMBRAMIENTO_INICIO: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El inicio de la jornada del nombramiento se escribe en formato HH:MM, por ejemplo 08:00.',
  },
  HORA_NOMBRAMIENTO_FIN: {
    valido: (valor) => PATRON_HORA.test(valor),
    mensaje:
      'El fin de la jornada del nombramiento se escribe en formato HH:MM, por ejemplo 16:00.',
  },
};

/**
 * Comprueba el valor propuesto contra el tipo, el dominio y el rango del parámetro.
 * @returns el motivo del rechazo, o `undefined` si el valor es admisible.
 */
export function motivoDeRechazo(
  parametro: ParametroPolitica,
  valor: string,
): string | undefined {
  const limpio = valor.trim();

  if (limpio.length === 0) {
    return `El parámetro ${parametro.clave} no puede quedar vacío.`;
  }

  switch (parametro.tipo) {
    case TipoParametro.ENTERO: {
      if (!/^-?\d+$/.test(limpio)) {
        return `${parametro.clave} admite solo números enteros.`;
      }
      return fueraDeRango(parametro, Number(limpio));
    }

    case TipoParametro.DECIMAL: {
      if (!/^-?\d+([.,]\d+)?$/.test(limpio)) {
        return `${parametro.clave} admite solo valores numéricos.`;
      }
      return fueraDeRango(parametro, Number(limpio.replace(',', '.')));
    }

    case TipoParametro.BOOLEANO: {
      return ['true', 'false'].includes(limpio.toLowerCase())
        ? undefined
        : `${parametro.clave} admite únicamente verdadero o falso.`;
    }

    case TipoParametro.TEXTO: {
      const dominio = DOMINIO_TEXTO[parametro.clave];
      if (dominio && !dominio.valido(limpio)) {
        return dominio.mensaje;
      }
      return undefined;
    }

    default:
      return undefined;
  }
}

/** Compara el valor numérico con el mínimo y el máximo declarados en la fila. */
function fueraDeRango(
  parametro: ParametroPolitica,
  valor: number,
): string | undefined {
  const minimo = parametro.minimo === null ? null : Number(parametro.minimo);
  const maximo = parametro.maximo === null ? null : Number(parametro.maximo);
  const unidad = parametro.unidad ? ` ${parametro.unidad}` : '';

  if (minimo !== null && valor < minimo) {
    return `El valor mínimo admitido para ${parametro.clave} es ${parametro.minimo}${unidad}.`;
  }
  if (maximo !== null && valor > maximo) {
    return `El valor máximo admitido para ${parametro.clave} es ${parametro.maximo}${unidad}.`;
  }
  return undefined;
}
