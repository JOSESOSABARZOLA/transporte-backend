/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-conductor.policy.ts
 * Responsabilidad: Decidir si un conductor puede recibir una asignación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * POL-02. Es **la base** que M-17 aplica al asignar transporte, y por eso vive aquí:
 * las reglas de descanso están en `talento-operativo` y en ningún otro sitio, tanto si
 * protegen a un inspector como si protegen a quien conduce.
 *
 * CUATRO REGLAS, NO SEIS. M-12 dejó escritas las dos primeras y advirtió que las otras
 * exigirían datos que el modelo no guarda. Al implementar M-17 se comprobó que **dos de
 * las cuatro sí eran calculables**: el solapamiento y la jornada del conductor salen de
 * los operativos que ya conduce ese día —`t_operativo.cond_id` con sus horas—, igual que
 * en el personal. Son VAL-21 y VAL-22, que el plan pide expresamente en M-17.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEIS DESDE EL 2026-08-31. Las dos que faltaban ya se pueden aplicar.
 *
 * Este comentario decía, desde M-17, que el tipo de contrato y el tope de salidas pesadas
 * «siguen sin poder aplicarse» porque `t_conductor` no guardaba el contrato y no había
 * proyección de conductores equivalente a `t_historial_jornada`. Las dos causas se
 * resolvieron el mismo día, y por caminos distintos:
 *
 *   · EL CONTRATO es ahora una columna, `cond_tipo_contrato`, del mismo enumerado que el
 *     personal. Un conductor de nombramiento y un inspector de nombramiento lo son en el
 *     mismo sentido, así que la regla es la misma (RN-26, RN-33).
 *   · EL TOPE se cuenta **en vivo** desde los operativos que condujo, sin proyección
 *     persistida. El motivo está en `salidasPesadasDeConductor`: son pocas filas por
 *     conductor y este archivo ya lo hacía así para RN-44.
 *
 * LAS DOS SE SALTAN SI EL DATO NO CONSTA, y eso es parte de la regla, no un descuido.
 * `cond_tipo_contrato` es nulable porque la flota se carga a mano; mientras no conste, la
 * regla del contrato NO se aplica. Suponer «nombramiento» impediría asignar de noche a
 * medio catálogo, y suponer lo contrario dejaría sin proteger a quien no debe salir.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { TipoContrato } from '@prisma/client';

import {
  CODIGOS_ERROR,
  type CodigoError,
} from '../../../../common/errors/codigos-error';
import type {
  FranjaNocturna,
  RangoHorario,
} from '../../../operativos/domain/rango-horario';
import type { VeredictoElegibilidad } from './descanso-personal.policy';

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/** Operativo que el conductor ya tiene ese día. VAL-21 y VAL-22. */
export interface ConduccionVigente {
  identificador: string;
  rango: RangoHorario;
  horas: number;
}

export interface AntecedentesConductor {
  nombre: string;
  ausencia?: { estado: string; hasta: Date };
  /** Última fecha en la que condujo en una patrulla. RN-44. */
  ultimaPatrulla?: Date | null;
  /** Operativos del mismo día que ya conduce. VAL-21 y VAL-22. */
  conduccionesDelDia?: ConduccionVigente[];
  /**
   * RN-26 y RN-33. `null` o ausente significa **no consta**, y entonces la regla del
   * contrato no se aplica. No es lo mismo que «contrato ocasional».
   */
  tipoContrato?: TipoContrato | null;
  /** RN-25. Salidas nocturnas o de fin de semana ya acumuladas en el período. */
  salidasPesadas?: number;
}

export interface ContextoConduccion {
  fecha: Date;
  esPatrulla: boolean;
  diasDescansoPatrulla: number;
  /** Horario del operativo que se pretende asignar. VAL-21 y VAL-22. */
  rango?: RangoHorario;
  jornadaMaximaHoras?: number;
  /** RN-25 y RN-26: solo las salidas pesadas cuentan para las dos reglas nuevas. */
  esNocturno?: boolean;
  esFinDeSemana?: boolean;
  topeSalidasPesadas?: number;
  /**
   * Ventana de la jornada del NOMBRAMIENTO (RN-26), por omisión 08:00–16:00. Opcional: si no
   * llega, la regla del contrato cae al criterio antiguo (solo noche y fin de semana).
   */
  ventanaNombramiento?: FranjaNocturna;
}

/**
 * Aplica las reglas del conductor y devuelve el primer motivo que impide asignarlo.
 *
 * Mismo orden de prioridad que en el personal: primero si está, después si descansó, y
 * al final si el horario cabe.
 */
export function verificarDescansoConductor(
  conductor: AntecedentesConductor,
  contexto: ContextoConduccion,
): VeredictoElegibilidad {
  if (conductor.ausencia) {
    return sinElegir(
      CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
      `${conductor.nombre} no está disponible: registra ${conductor.ausencia.estado.toLowerCase().replace('_', ' ')} hasta el ${conductor.ausencia.hasta.toISOString().slice(0, 10)}.`,
    );
  }

  // RN-44. El conductor que condujo en patrulla el día anterior tampoco repite.
  if (contexto.esPatrulla && conductor.ultimaPatrulla) {
    const dias = diferenciaEnDias(conductor.ultimaPatrulla, contexto.fecha);

    if (dias >= 0 && dias <= contexto.diasDescansoPatrulla) {
      return sinElegir(
        CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA,
        `${conductor.nombre} condujo en patrulla ${dias === 0 ? 'ese mismo día' : dias === 1 ? 'el día anterior' : `hace ${dias} días`} y no puede repetir.`,
      );
    }
  }

  return (
    reglaTipoContrato(conductor, contexto) ??
    reglaTopeSalidasPesadas(conductor, contexto) ??
    reglaSolapamiento(conductor, contexto) ??
    reglaJornadaMaxima(conductor, contexto) ?? { elegible: true }
  );
}

/**
 * RN-26 y RN-33. El conductor de NOMBRAMIENTO cumple jornada de lunes a viernes DENTRO de la
 * ventana (por omisión 08H00 a 16H00): no sale de noche, ni en fin de semana, ni en horas extra.
 *
 * ES LA MISMA REGLA DEL PERSONAL, con el mismo código de error. VENTANA ESTRICTA DESDE EL
 * 2026-09-22 (ver `descanso-personal.policy.ts`): antes se permitían las horas extra en día
 * laborable; el negocio pidió endurecerlo. Sin ventana configurada cae al criterio antiguo.
 *
 * SIN CONTRATO NO SE APLICA. `cond_tipo_contrato` es nulable porque la flota se carga a
 * mano; suponer «nombramiento» impediría asignar de noche a medio catálogo por un dato
 * que nadie ha llegado a escribir todavía.
 */
function reglaTipoContrato(
  conductor: AntecedentesConductor,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (conductor.tipoContrato !== TipoContrato.NOMBRAMIENTO) return undefined;

  // Fuera de horario: con ventana, que el operativo no caiga en 08:00–16:00 (abarca noche y horas
  // extra); sin ventana, el criterio antiguo (solo la noche). El rango es opcional en el conductor.
  const fueraDeHorario =
    contexto.ventanaNombramiento && contexto.rango
      ? !contexto.rango.estaDentroDe(contexto.ventanaNombramiento)
      : contexto.esNocturno;

  if (!contexto.esFinDeSemana && !fueraDeHorario) return undefined;

  const situacion = contexto.esFinDeSemana
    ? 'un operativo de fin de semana'
    : contexto.esNocturno
      ? 'un turno nocturno'
      : 'un operativo fuera de su horario';

  const jornada = contexto.ventanaNombramiento
    ? `${contexto.ventanaNombramiento.inicio.replace(':', 'H')} a ${contexto.ventanaNombramiento.fin.replace(':', 'H')}`
    : '08H00 a 16H30';

  return sinElegir(
    CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO,
    `${conductor.nombre} es conductor de nombramiento y no puede asignarse a ${situacion}. El personal de nombramiento cumple jornada de lunes a viernes de ${jornada}.`,
  );
}

/**
 * RN-25. El conductor no supera su tope de salidas nocturnas o de fin de semana.
 *
 * Solo cuenta si ESTA asignación es pesada: sumar un martes diurno al tope no tendría
 * sentido, y la regla existe para repartir las guardias. Mismo criterio que el personal.
 *
 * El umbral es `TOPE_SALIDAS_PESADAS` y el período `PERIODO_COMPUTO_SALIDAS`: los dos ya
 * existen en `t_parametro_politica` desde M-06, así que el negocio los ajusta sin tocar
 * código y **no hizo falta inventar ningún parámetro nuevo** para esta regla.
 */
function reglaTopeSalidasPesadas(
  conductor: AntecedentesConductor,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (!contexto.esNocturno && !contexto.esFinDeSemana) return undefined;
  if (
    conductor.salidasPesadas === undefined ||
    contexto.topeSalidasPesadas === undefined
  ) {
    return undefined;
  }
  if (conductor.salidasPesadas < contexto.topeSalidasPesadas) return undefined;

  return sinElegir(
    CODIGOS_ERROR.TOPE_SALIDAS_PESADAS,
    `${conductor.nombre} alcanzó el tope de ${contexto.topeSalidasPesadas} salidas nocturnas o de fin de semana en el período. Considere repartir la carga con otro conductor.`,
  );
}

/**
 * VAL-21. El conductor no puede estar en dos operativos con horarios cruzados.
 *
 * La aritmética la resuelve `RangoHorario`, la misma que usa el personal: el cruce de
 * medianoche es el punto de error más probable del sistema (FASE3 §OV-02) y no admite
 * una segunda versión.
 */
function reglaSolapamiento(
  conductor: AntecedentesConductor,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (!contexto.rango || !conductor.conduccionesDelDia) return undefined;

  const conflicto = conductor.conduccionesDelDia.find((conduccion) =>
    conduccion.rango.seSolapaCon(contexto.rango as RangoHorario),
  );

  if (!conflicto) return undefined;

  return sinElegir(
    CODIGOS_ERROR.SOLAPAMIENTO_HORARIO,
    `${conductor.nombre} ya conduce en el operativo ${conflicto.identificador} de ${conflicto.rango.toString()}, que se cruza con este horario.`,
  );
}

/**
 * VAL-22. La suma de horas al volante no supera la jornada máxima.
 *
 * Mismo umbral configurable que el personal —`JORNADA_MAXIMA_HORAS`—, y por el mismo
 * motivo: los accidentes que originaron el proyecto vinieron de jornadas encadenadas, y
 * quien conduce fatigado es exactamente el riesgo del que hablaban las transcripciones.
 */
function reglaJornadaMaxima(
  conductor: AntecedentesConductor,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (
    !contexto.rango ||
    !conductor.conduccionesDelDia ||
    contexto.jornadaMaximaHoras === undefined
  ) {
    return undefined;
  }

  const acumuladas = conductor.conduccionesDelDia.reduce(
    (suma, conduccion) => suma + conduccion.horas,
    0,
  );
  const total = acumuladas + contexto.rango.duracionHoras;

  if (total <= contexto.jornadaMaximaHoras) return undefined;

  return sinElegir(
    CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA,
    `${conductor.nombre} acumularía ${total} horas al volante ese día y el máximo es ${contexto.jornadaMaximaHoras}.`,
  );
}

function sinElegir(codigo: CodigoError, motivo: string): VeredictoElegibilidad {
  return { elegible: false, codigo, motivo };
}

function diferenciaEnDias(desde: Date, hasta: Date): number {
  const inicio = Date.UTC(
    desde.getUTCFullYear(),
    desde.getUTCMonth(),
    desde.getUTCDate(),
  );
  const fin = Date.UTC(
    hasta.getUTCFullYear(),
    hasta.getUTCMonth(),
    hasta.getUTCDate(),
  );
  return Math.round((fin - inicio) / MILISEGUNDOS_POR_DIA);
}
