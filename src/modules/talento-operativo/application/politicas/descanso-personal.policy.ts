/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-personal.policy.ts
 * Responsabilidad: Decidir si una persona puede recibir una asignación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POL-01. ES LA RAZÓN POR LA QUE EXISTE EL PROYECTO.
 *
 * Las transcripciones describen funcionarios de dieciséis horas, patrullas en días
 * consecutivos y accidentes por jornadas encadenadas. Estas seis reglas son lo que el
 * sistema hace para que eso deje de ocurrir.
 *
 * VIVEN AQUÍ Y SOLO AQUÍ. Si aparece lógica de descanso en `operativos` o en
 * `transporte`, es un defecto que debe reportarse.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ES UNA FUNCIÓN PURA. No consulta la base, no lee parámetros y no conoce NestJS:
 * recibe los antecedentes de la persona, el contexto de la asignación y los umbrales
 * ya resueltos. Esa decisión es lo que permite que los trece casos del plan se prueben
 * sin levantar nada, y que un fallo aquí se vea en la prueba y no en una jornada real.
 *
 * DEVUELVE EL PRIMER MOTIVO, en el orden fijado por el plan. Enumerar todos los
 * incumplimientos daría un mensaje que nadie lee entero; el primero es el que hay que
 * resolver, y cuando se resuelva aparecerá el siguiente si lo hubiera.
 */

import { EstadoTurno, TipoContrato } from '@prisma/client';

import {
  CODIGOS_ERROR,
  type CodigoError,
} from '../../../../common/errors/codigos-error';
import type {
  FranjaNocturna,
  RangoHorario,
} from '../../../operativos/domain/rango-horario';

/** Lo único que sale de la política. **Ningún dato estructurado del funcionario.** */
export interface VeredictoElegibilidad {
  elegible: boolean;
  codigo?: CodigoError;
  /** Redactado para el funcionario: nombra a la persona y explica el motivo. */
  motivo?: string;
}

/** La asignación que se pretende hacer. */
export interface ContextoAsignacion {
  fecha: Date;
  rango: RangoHorario;
  /** `form_es_patrulla` del formulario destino. RN-24. */
  esPatrulla: boolean;
  /** Derivado del rango y de la franja nocturna configurada. RN-43. */
  esNocturno: boolean;
  /** Derivado de la fecha, en UTC. RN-25. */
  esFinDeSemana: boolean;
}

/** Umbrales leídos de `t_parametro_politica`. Nunca constantes literales. */
export interface UmbralesDescanso {
  diasDescansoPatrulla: number;
  topeSalidasPesadas: number;
  jornadaMaximaHoras: number;
  /**
   * Ventanas de los turnos de la cobertura de Instrucción, de los parámetros
   * `HORA_TURNO_DIURNO_*` y `HORA_TURNO_NOCTURNO_*`. Opcionales: si no llegan, la regla
   * del turno no se aplica (misma prudencia que con un umbral ausente).
   */
  ventanaDiurna?: FranjaNocturna;
  ventanaNocturna?: FranjaNocturna;
  /**
   * Ventana de la jornada del personal de NOMBRAMIENTO (RN-26): de los parámetros
   * `HORA_NOMBRAMIENTO_INICIO` / `HORA_NOMBRAMIENTO_FIN` (por omisión 08:00–16:00). Opcional: si
   * no llega, la regla del contrato cae al criterio antiguo (solo noche y fin de semana).
   */
  ventanaNombramiento?: FranjaNocturna;
}

/** Un operativo al que la persona ya está asignada ese día. */
export interface AsignacionVigente {
  identificador: string;
  rango: RangoHorario;
  horas: number;
}

/** Ausencia que cubre la fecha de la asignación. */
export interface AusenciaVigente {
  estado: string;
  hasta: Date;
}

/** Todo lo que hay que saber de la persona para decidir. */
export interface AntecedentesPersona {
  /** `APELLIDOS NOMBRES`, para redactar el mensaje. */
  nombre: string;
  tipoContrato: TipoContrato;
  ausencia?: AusenciaVigente;
  /** Fecha de la última jornada en patrulla, del historial. RN-24. */
  ultimaPatrulla?: Date | null;
  /** Salidas nocturnas o de fin de semana en el período de cómputo. RN-25. */
  salidasPesadas: number;
  /** Operativos del mismo día a los que ya está asignada. RN-28 y RN-36. */
  asignacionesDelDia: AsignacionVigente[];
  /**
   * Turno de la cobertura de Instrucción para la fecha del operativo, si lo tiene.
   *
   * Opcional: solo el personal de Instrucción tiene cobertura, así que para el resto
   * llega `undefined` y las dos reglas de cobertura no se disparan. DESCANSO excluye;
   * DIURNO/NOCTURNO exigen que el horario del operativo caiga en su ventana.
   */
  turnoCobertura?: EstadoTurno;
}

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

const ELEGIBLE: VeredictoElegibilidad = { elegible: true };

/**
 * Aplica las reglas, en orden, y devuelve el primer motivo que impide asignar.
 *
 * Son las seis reglas de descanso más el turno de descanso de la cobertura de
 * Instrucción, que se comprueba junto a la disponibilidad porque es la misma idea —«ese
 * día no trabaja»— desde otra fuente. La ausencia va primero: su mensaje trae la fecha de
 * retorno, más útil que «está en descanso».
 *
 * @returns `{ elegible: true }` si ninguna la impide.
 */
export function verificarDescanso(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad {
  return (
    reglaDisponibilidad(persona) ??
    reglaCoberturaDescanso(persona) ??
    reglaTurnoCobertura(persona, contexto, umbrales) ??
    reglaTipoContrato(persona, contexto, umbrales) ??
    reglaPatrullaConsecutiva(persona, contexto, umbrales) ??
    reglaTopeSalidasPesadas(persona, contexto, umbrales) ??
    reglaSolapamiento(persona, contexto) ??
    reglaJornadaMaxima(persona, contexto, umbrales) ??
    ELEGIBLE
  );
}

// ───────────────────────── 1 · Disponibilidad ─────────────────────────

/**
 * RN-30 y VAL-12. Vacaciones, permiso, calamidad y reposo médico excluyen.
 *
 * El mensaje indica **el estado y la fecha de retorno**, como exige VAL-12: quien arma
 * el cuadro necesita saber cuándo puede volver a contar con la persona. **No incluye
 * `disp_motivo`**, que es texto libre y puede describir una condición de salud.
 */
function reglaDisponibilidad(
  persona: AntecedentesPersona,
): VeredictoElegibilidad | undefined {
  if (!persona.ausencia) return undefined;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.PERSONA_NO_DISPONIBLE,
    motivo: `${persona.nombre} no está disponible: registra ${enPalabras(persona.ausencia.estado)} hasta el ${enFecha(persona.ausencia.hasta)}.`,
  };
}

// ──────────────────── 1·bis · Descanso de la cobertura ────────────────────

/**
 * Cobertura por turnos (Instrucción). El turno DESCANSO ese día excluye a la persona.
 *
 * DIURNO, NOCTURNO y la ausencia de celda NO bloquean: solo el descanso explícito, que en
 * el instrumento de Instrucción significa «ese día no trabaja». El resto del personal no
 * tiene cobertura, así que `enDescanso` llega `undefined` y esta regla no le afecta.
 */
function reglaCoberturaDescanso(
  persona: AntecedentesPersona,
): VeredictoElegibilidad | undefined {
  if (persona.turnoCobertura !== EstadoTurno.DESCANSO) return undefined;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.PERSONA_EN_DESCANSO,
    motivo: `${persona.nombre} tiene turno de descanso ese día en la cobertura por turnos de Instrucción. Cámbielo en «Cobertura por turnos» o asigne a otra persona.`,
  };
}

// ─────────────────── 1·ter · Ventana del turno de cobertura ───────────────────

/**
 * Cobertura por turnos (Instrucción). Si la persona tiene turno DIURNO o NOCTURNO ese día,
 * el horario del operativo debe caer ENTERO dentro de la ventana de ese turno, que fijan
 * los parámetros `HORA_TURNO_DIURNO_*` y `HORA_TURNO_NOCTURNO_*`.
 *
 * Sin turno (celda vacía) no hay ventana que exigir, así que no se aplica; el turno
 * nocturno puede cruzar la medianoche y `RangoHorario.estaDentroDe` lo contempla. Si la
 * ventana no está configurada, la regla se abstiene en vez de bloquear.
 */
function reglaTurnoCobertura(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad | undefined {
  const esDiurno = persona.turnoCobertura === EstadoTurno.DIURNO;
  const esNocturno = persona.turnoCobertura === EstadoTurno.NOCTURNO;
  if (!esDiurno && !esNocturno) return undefined;

  const ventana = esDiurno ? umbrales.ventanaDiurna : umbrales.ventanaNocturna;
  if (!ventana) return undefined;
  if (contexto.rango.estaDentroDe(ventana)) return undefined;

  const nombreTurno = esDiurno ? 'diurno' : 'nocturno';

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.TURNO_FUERA_DE_RANGO,
    motivo: `${persona.nombre} tiene turno ${nombreTurno} ese día (${institucional(ventana.inicio)} a ${institucional(ventana.fin)}) y el horario del operativo ${contexto.rango.toString()} no cae dentro de esa ventana. Ajuste el horario o el turno en «Cobertura por turnos».`,
  };
}

// ───────────────────────── 2 · Tipo de contrato ─────────────────────────

/**
 * RN-26, RN-33 y VAL-13. El personal de NOMBRAMIENTO cumple jornada de lunes a viernes DENTRO de la
 * ventana `HORA_NOMBRAMIENTO_INICIO`–`HORA_NOMBRAMIENTO_FIN` (por omisión 08H00 a 16H00), y no
 * participa fuera de ella: ni de noche, ni en fin de semana, ni en horas extra.
 *
 * VENTANA ESTRICTA DESDE EL 2026-09-22, por decisión del negocio. Antes se comprobaba SOLO lo que
 * VAL-13 declaraba —turno nocturno o fin de semana— y un operativo de 17H00 a 19H00 en día
 * laborable SÍ se permitía (horas extra, ver M12_POLITICAS_DESCANSO.md §8). El negocio pidió
 * endurecerlo: ahora se rechaza TODO lo que no caiga en la ventana. La ventana es un PARÁMETRO
 * (regla 2 de CLAUDE.md); si faltara, la regla cae al criterio antiguo (solo noche y fin de semana).
 */
function reglaTipoContrato(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad | undefined {
  if (persona.tipoContrato !== TipoContrato.NOMBRAMIENTO) return undefined;

  // Con ventana configurada, «fuera de horario» es que el operativo NO cabe en 08:00–16:00 (lo que
  // abarca la noche y las horas extra). Sin ventana, se cae al criterio antiguo (solo la noche).
  const fueraDeHorario = umbrales.ventanaNombramiento
    ? !contexto.rango.estaDentroDe(umbrales.ventanaNombramiento)
    : contexto.esNocturno;

  if (!contexto.esFinDeSemana && !fueraDeHorario) return undefined;

  const situacion = contexto.esFinDeSemana
    ? 'un operativo de fin de semana'
    : contexto.esNocturno
      ? 'un turno nocturno'
      : 'un operativo fuera de su horario';

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.CONTRATO_NO_ADMITE_TURNO,
    motivo: `${persona.nombre} es personal de nombramiento y no puede asignarse a ${situacion}. El personal de nombramiento cumple jornada de lunes a viernes de ${jornadaNombramiento(umbrales)}.`,
  };
}

/** El texto de la jornada del nombramiento, «08H00 a 16H00», tomado de la ventana configurada. */
function jornadaNombramiento(umbrales: UmbralesDescanso): string {
  const ventana = umbrales.ventanaNombramiento;
  if (!ventana) return '08H00 a 16H30';
  return `${ventana.inicio.replace(':', 'H')} a ${ventana.fin.replace(':', 'H')}`;
}

// ─────────────────────── 3 · Patrulla consecutiva ───────────────────────

/**
 * RN-24 y VAL-14. Quien salió en patrulla un día no puede repetir al siguiente,
 * **ni diurna ni nocturna**.
 *
 * El bloqueo es CRUZADO entre patrullas: la regla no pregunta por el formulario, sino
 * por el hecho de haber salido en patrulla. Los días de descanso los fija el parámetro
 * `DIAS_DESCANSO_PATRULLA`, de modo que el negocio puede subirlo a dos o tres sin
 * tocar código.
 */
function reglaPatrullaConsecutiva(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad | undefined {
  if (!contexto.esPatrulla) return undefined;
  if (!persona.ultimaPatrulla) return undefined;

  const diasTranscurridos = diferenciaEnDias(
    persona.ultimaPatrulla,
    contexto.fecha,
  );

  // Una patrulla FUTURA respecto de la fecha evaluada no descansa a nadie: solo
  // cuentan las que ya ocurrieron.
  if (diasTranscurridos < 0) return undefined;
  if (diasTranscurridos > umbrales.diasDescansoPatrulla) return undefined;

  const cuando =
    diasTranscurridos === 0
      ? 'ese mismo día'
      : diasTranscurridos === 1
        ? 'el día anterior'
        : `hace ${diasTranscurridos} días`;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.PATRULLA_CONSECUTIVA,
    motivo: `${persona.nombre} salió en patrulla ${cuando} y no puede repetir, ni diurna ni nocturna. Debe descansar ${umbrales.diasDescansoPatrulla} día${umbrales.diasDescansoPatrulla === 1 ? '' : 's'} entre patrullas.`,
  };
}

// ────────────────────── 4 · Tope de salidas pesadas ──────────────────────

/**
 * RN-25 y VAL-15. Máximo de salidas nocturnas o de fin de semana por período.
 *
 * Solo se comprueba cuando la asignación ES pesada: sumar una salida diurna de un
 * martes al tope no tendría sentido, y la regla existe para repartir las guardias.
 */
function reglaTopeSalidasPesadas(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad | undefined {
  if (!contexto.esNocturno && !contexto.esFinDeSemana) return undefined;
  if (persona.salidasPesadas < umbrales.topeSalidasPesadas) return undefined;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.TOPE_SALIDAS_PESADAS,
    motivo: `${persona.nombre} alcanzó el tope de ${umbrales.topeSalidasPesadas} salidas nocturnas o de fin de semana en el período. Considere repartir la carga con otra persona.`,
  };
}

// ─────────────────────── 5 · Solapamiento horario ───────────────────────

/**
 * RN-28 y VAL-16. Una persona no puede figurar en dos operativos que se cruzan.
 *
 * La comparación la resuelve `RangoHorario`, que contempla el cruce de medianoche:
 * es el caso 8 del plan —22H00 a 02H00 contra 01H00 a 05H00— y la razón por la que
 * ese objeto de valor se implementó antes que esta política.
 */
function reglaSolapamiento(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
): VeredictoElegibilidad | undefined {
  const conflicto = persona.asignacionesDelDia.find((asignacion) =>
    asignacion.rango.seSolapaCon(contexto.rango),
  );

  if (!conflicto) return undefined;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.SOLAPAMIENTO_HORARIO,
    motivo: `${persona.nombre} ya está asignada al operativo ${conflicto.identificador} de ${conflicto.rango.toString()}, que se cruza con este horario.`,
  };
}

// ───────────────────── 6 · Jornada máxima diaria ─────────────────────

/**
 * RN-36 y VAL-17. La suma de asignaciones del día no supera el umbral.
 *
 * El umbral sale de `JORNADA_MAXIMA_HORAS`. **RN-36 sigue marcada como pendiente de
 * validación**: las fuentes describen jornadas de dieciséis horas como la situación a
 * evitar, sin fijar el límite. Por eso es un parámetro y no un número escrito aquí:
 * el día que la Dirección lo decida, se cambia en una pantalla.
 */
function reglaJornadaMaxima(
  persona: AntecedentesPersona,
  contexto: ContextoAsignacion,
  umbrales: UmbralesDescanso,
): VeredictoElegibilidad | undefined {
  const acumuladas = persona.asignacionesDelDia.reduce(
    (total, asignacion) => total + asignacion.horas,
    0,
  );
  const total = redondear(acumuladas + contexto.rango.duracionHoras);

  if (total <= umbrales.jornadaMaximaHoras) return undefined;

  return {
    elegible: false,
    codigo: CODIGOS_ERROR.JORNADA_MAXIMA_SUPERADA,
    motivo: `${persona.nombre} acumularía ${enHoras(total)} en el día y el máximo es ${enHoras(umbrales.jornadaMaximaHoras)}. Ya tiene ${enHoras(redondear(acumuladas))} asignadas.`,
  };
}

// ─────────────────────────── Apoyo ───────────────────────────

/** Días completos entre dos fechas de calendario. Positivo si la primera es anterior. */
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

function redondear(horas: number): number {
  return Math.round(horas * 10) / 10;
}

function enHoras(horas: number): string {
  const texto = Number.isInteger(horas) ? String(horas) : horas.toFixed(1);
  return `${texto.replace('.', ',')} horas`;
}

function enFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** `HH:MM` a la forma institucional `HHhMM` (18:00 → 18H00), como el resto del sistema. */
function institucional(hora: string): string {
  return hora.replace(':', 'H');
}

/** El estado del enumerado, escrito como lo diría una persona. */
function enPalabras(estado: string): string {
  const palabras: Record<string, string> = {
    VACACIONES: 'vacaciones',
    REPOSO_MEDICO: 'reposo médico',
    CALAMIDAD: 'calamidad doméstica',
    PERMISO: 'permiso',
  };
  return palabras[estado] ?? estado.toLowerCase().replace('_', ' ');
}
