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

/** Siete enteros ≥ 0 separados por comas (L,M,X,J,V,S,D), o SIN_CONFIGURAR. 2026-10-07. */
const PATRON_MINIMOS = /^\d{1,3}(,\d{1,3}){6}$/;

function esMinimosPorDia(valor: string): boolean {
  const limpio = valor.replace(/\s+/g, '');
  return (
    limpio.toUpperCase() === 'SIN_CONFIGURAR' || PATRON_MINIMOS.test(limpio)
  );
}

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
  // Cobertura por turnos (Instrucción), 2026-10-05: ¿se admite diurno tras nocturno? Solo avisa.
  COBERTURA_PERMITE_NOCTURNO_A_DIURNO: {
    valido: (valor) =>
      ['SIN_CONFIGURAR', 'SI', 'NO'].includes(valor.toUpperCase()),
    mensaje:
      'Admite SI, NO o SIN_CONFIGURAR (no se evalúa). Con NO, la matriz avisa de un diurno tras un nocturno.',
  },
  // Turnos de conductores de la DAF (2026-10-07): ¿se admite DÍA tras NOCHE? La propuesta del mes
  // no lo propone con NO; SIN_CONFIGURAR no se evalúa.
  DAF_PERMITE_NOCHE_A_DIA: {
    valido: (valor) =>
      ['SIN_CONFIGURAR', 'SI', 'NO'].includes(valor.toUpperCase()),
    mensaje:
      'Admite SI, NO o SIN_CONFIGURAR (no se evalúa). Con NO, la propuesta del mes no pone un DÍA tras una NOCHE.',
  },
  // Mínimo de conductores por turno y día de la semana (L,M,X,J,V,S,D), 2026-10-07.
  DAF_MIN_CONDUCTORES_DIA: {
    valido: esMinimosPorDia,
    mensaje:
      'Escriba SIN_CONFIGURAR o siete enteros ≥ 0 separados por comas, de lunes a domingo (p. ej. 6,6,6,6,6,4,4).',
  },
  DAF_MIN_CONDUCTORES_NOCHE: {
    valido: esMinimosPorDia,
    mensaje:
      'Escriba SIN_CONFIGURAR o siete enteros ≥ 0 separados por comas, de lunes a domingo (p. ej. 3,3,3,3,3,3,3).',
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
  // Transporte por tramos (2026-10-06): las horas de la línea de tiempo de los conductores.
  ...horasDeTransporte({
    HORA_NOMBRAMIENTO_CONDUCTOR_FIN:
      'El fin de la jornada del conductor de nombramiento',
    INICIO_JORNADA_TRANSPORTE: 'El inicio de la línea de tiempo del transporte',
    HORA_TURNO_CONDUCTOR_DIA_INICIO: 'El inicio del turno DÍA de conductores',
    HORA_TURNO_CONDUCTOR_DIA_FIN: 'El fin del turno DÍA de conductores',
    HORA_TURNO_CONDUCTOR_NOCHE_INICIO:
      'El inicio del turno NOCHE de conductores',
    HORA_TURNO_CONDUCTOR_NOCHE_FIN: 'El fin del turno NOCHE de conductores',
    HORA_TURNO_CONDUCTOR_ECU_NOCHE_INICIO:
      'El inicio del turno ECU NOCHE de conductores',
    HORA_TURNO_CONDUCTOR_ECU_NOCHE_FIN:
      'El fin del turno ECU NOCHE de conductores',
    // Fin del día (2026-10-06): desde qué hora un cierre se considera «tarde» para la guarda.
    GUARDA_HORA_TARDE: 'La hora a partir de la cual un cierre es tarde',
  }),
};

function horasDeTransporte(
  sujetos: Record<string, string>,
): Record<string, { valido: (valor: string) => boolean; mensaje: string }> {
  return Object.fromEntries(
    Object.entries(sujetos).map(([clave, sujeto]) => [
      clave,
      {
        valido: (valor: string) => PATRON_HORA.test(valor),
        mensaje: `${sujeto} se escribe en formato HH:MM, por ejemplo 16:30.`,
      },
    ]),
  );
}

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
