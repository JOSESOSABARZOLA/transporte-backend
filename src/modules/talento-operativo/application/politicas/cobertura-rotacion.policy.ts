/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-rotacion.policy.ts
 * Responsabilidad: Proponer el turno de las celdas vacías continuando el ciclo de cada persona.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * «CONTINUAR ROTACIÓN». Instrucción planifica por ciclos (5D+2—, 2D+2N+2—…). Esto detecta el ciclo
 * de una persona y lo prolonga sobre lo que falta por planificar.
 *
 * CÓMO SE DETECTA: con lo conocido desde los 28 días anteriores al PRIMER HUECO hasta el fin del
 * mes, se busca el período MÁS CORTO p ∈ [2, 14] con el que todos los días conocidos que distan un
 * múltiplo de p tienen el mismo turno, y en el que cada fase del ciclo tiene al menos un dato. Las
 * ausencias y las celdas vacías son «sin dato»: ni confirman ni contradicen.
 *
 * QUÉ NUNCA HACE: tocar una ausencia o un día ya planificado. Solo propone para celdas VACÍAS del
 * mes. Si ningún período encaja, no propone nada para esa persona (mejor nada que inventar).
 *
 * ES PURA: recibe la secuencia de una persona y devuelve las propuestas por índice.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type TurnoRotacion = 'DIURNO' | 'NOCTURNO' | 'DESCANSO';

/**
 * Un día de la secuencia: un turno, `null` (vacío) o una ausencia. Genérico desde el 2026-10-06:
 * los turnos de conductores (DIA/NOCHE/ECU_NOCHE/LIBRE/ADMINISTRATIVO) reutilizan la misma
 * detección de ciclo. Por omisión, los tres turnos de la cobertura de Instrucción.
 */
export type DiaRotacion<T extends string = TurnoRotacion> =
  | T
  | null
  | 'AUSENCIA';

export interface PropuestaRotacion<T extends string = TurnoRotacion> {
  indice: number;
  estado: T;
}

export interface ResultadoRotacion<T extends string = TurnoRotacion> {
  propuestas: PropuestaRotacion<T>[];
  /** Días de ausencia del mes, posteriores al primer hueco, que se saltan. */
  omitidas: number;
}

const DIAS_ANTERIORES = 28;
const PERIODO_MINIMO = 2;
const PERIODO_MAXIMO = 14;

const esTurno = <T extends string>(dia: DiaRotacion<T>): dia is T =>
  dia !== null && dia !== 'AUSENCIA';

/** El turno de cada fase del período, o `null` si el período no encaja o le falta una fase. */
function fasesDelPeriodo<T extends string>(
  conocidos: { indice: number; turno: T }[],
  periodo: number,
): Map<number, T> | null {
  const fases = new Map<number, T>();
  for (const { indice, turno } of conocidos) {
    const fase = indice % periodo;
    const previo = fases.get(fase);
    if (previo !== undefined && previo !== turno) return null;
    fases.set(fase, turno);
  }
  return fases.size === periodo ? fases : null;
}

/**
 * @param secuencia días de la persona; los anteriores al mes van primero.
 * @param inicioMes índice de la secuencia donde empieza el mes que se completa.
 */
export function proponerRotacion<T extends string = TurnoRotacion>(
  secuencia: readonly DiaRotacion<T>[],
  inicioMes: number,
): ResultadoRotacion<T> {
  const primerHueco = secuencia.findIndex(
    (dia, indice) => indice >= inicioMes && dia === null,
  );
  if (primerHueco === -1) return { propuestas: [], omitidas: 0 };

  const desde = Math.max(0, primerHueco - DIAS_ANTERIORES);
  const conocidos: { indice: number; turno: T }[] = [];
  for (let indice = desde; indice < secuencia.length; indice += 1) {
    const dia = secuencia[indice];
    if (esTurno(dia)) conocidos.push({ indice, turno: dia });
  }

  for (let periodo = PERIODO_MINIMO; periodo <= PERIODO_MAXIMO; periodo += 1) {
    const fases = fasesDelPeriodo(conocidos, periodo);
    if (!fases) continue;

    const propuestas: PropuestaRotacion<T>[] = [];
    let omitidas = 0;
    for (let indice = primerHueco; indice < secuencia.length; indice += 1) {
      const dia = secuencia[indice];
      if (dia === 'AUSENCIA') {
        omitidas += 1;
      } else if (dia === null) {
        const estado = fases.get(indice % periodo);
        if (estado) propuestas.push({ indice, estado });
      }
    }
    return { propuestas, omitidas };
  }

  return { propuestas: [], omitidas: 0 };
}
