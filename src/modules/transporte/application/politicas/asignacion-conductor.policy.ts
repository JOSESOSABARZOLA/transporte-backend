/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · asignación por tramos
 * Archivo: asignacion-conductor.policy.ts
 * Responsabilidad: Decir si un conductor puede tomar un bloque de tramos, con qué avisos y a qué costo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL CONDUCTOR ENCADENA VARIOS OPERATIVOS EN EL DÍA (06H30–08H00, 15H00–17H00, 19H00–21H00, 02H00
 * Cumbayá…). Esta política evalúa si un BLOQUE (los tramos de un operativo o de una cadena) cabe en
 * su día, y devuelve tres cosas:
 *
 *   · DUROS  — impiden asignar: se pisa con otro tramo, no llega por el traslado (también desde el
 *              destino de una TAREA de taller), nombramiento fuera de su ventana o en fin de semana,
 *              jornada > DAF_MAX_JORNADA_HORAS, turno LIBRE sin activar, más personas que asientos,
 *              vehículo en taller, conductor ausente.
 *   · AVISOS — se puede, pero conviene saberlo: fuera de su turno (horas extra), descanso desde el
 *              último tramo de ayer < DAF_DESCANSO_MIN_HORAS, jornada > DAF_JORNADA_AVISO_HORAS, el vehículo
 *              amanece lejos del primer punto.
 *   · COSTO  — para ordenar candidatos (lo usa el optimizador de la Fase 3): minutos de traslado +
 *              penalizaciones por aviso, por activar un libre y por arrancar lejos.
 *
 * Todos los umbrales llegan como PARÁMETROS (regla 2); aquí no hay ni un número de negocio.
 *
 * LOS TRAMOS DEJAR/RETIRAR OCUPAN SOLO SU FRANJA. Entre medio el conductor está libre, así que puede
 * tomar otro bloque si le da el traslado. Dentro de un mismo bloque (una cadena del mismo
 * funcionario) no se exige traslado entre sus tramos: es el mismo recorrido con la misma gente.
 *
 * RELACIÓN CON `descanso-conductor.policy` (talento-operativo), desde el 2026-10-14: la asignación
 * es SOLO por tramos (también `PATCH /transporte/operativos/:id`, que delega aquí). Las dos reglas
 * que necesitan el historial de otros días —RN-44 patrulla consecutiva y RN-25 tope de salidas
 * pesadas— las decide `talento-operativo` y llegan HECHAS en `bloque.restricciones` (veredictos,
 * nunca antecedentes): aquí solo se suman a los DUROS. El resto se mide aquí, en minutos sobre la
 * línea de tiempo 05H00→05H00 y con traslados.
 *
 * DOS MEDIDAS PARA ORDENAR CANDIDATOS (2026-10-14, prioridades del optimizador): el traslado desde
 * el tramo ANTERIOR del conductor (continuidad territorial; si aún no tiene tramos, desde donde
 * amanece su vehículo) y cuánto se ALARGA su jornada (0 si el bloque cae en un hueco que ya tiene).
 * No cambian ni los duros ni los avisos.
 *
 * ES PURA: sin base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  estaDentro,
  institucional,
  MINUTOS_DIA,
  seSolapan,
  type Franja,
} from './linea-de-tiempo';
import {
  minutosTraslado,
  type Lugar,
  type ParametrosTraslado,
  type TablaTraslados,
} from './traslados';

/** Un tramo en la línea de tiempo del día. */
export interface TramoEvaluado {
  franja: Franja;
  origen: Lugar | null;
  destino: Lugar | null;
  /** Para los mensajes: «IG-001 (dejar)», «taller», etc. */
  etiqueta: string;
}

export type TurnoDelConductor =
  | 'DIA'
  | 'NOCHE'
  | 'ECU_NOCHE'
  | 'LIBRE'
  | 'ADMINISTRATIVO';

export interface VehiculoEvaluado {
  id: number;
  /** Plazas para pasajeros; `null` = no registrado (no se controla). */
  asientos: number | null;
  enTaller: boolean;
  /** Dónde amanece ese día, si se sabe. */
  amaneceEn: Lugar | null;
}

export interface ConductorEvaluado {
  id: number;
  nombre: string;
  tipoContrato: 'NOMBRAMIENTO' | 'OCASIONAL' | null;
  /** Turno planificado ese día, o `null` si no está planificado. */
  turno: TurnoDelConductor | null;
  /** Un LIBRE activado ese día (horas extra). */
  activado: boolean;
  /** Tiene una ausencia (vacaciones, reposo…) ese día. */
  ausente: boolean;
  /**
   * Fin del último tramo de AYER, en minutos de la línea de tiempo de HOY (negativo o pequeño; p. ej.
   * terminó ayer a la 01H00 de la noche → 60). `null` si ayer no trabajó.
   */
  ultimoFinAyer: number | null;
}

export interface BloqueEvaluado {
  tramos: TramoEvaluado[];
  /** Personas a transportar en el bloque. */
  personas: number;
  /**
   * Restricciones de descanso que `talento-operativo` ya decidió para ESTE conductor y ESTE bloque
   * (RN-44, RN-25). Se suman a los DUROS tal cual. Ausente = ninguna.
   */
  restricciones?: readonly Motivo[];
  /**
   * La TAREA «Llevar a taller» (Fase 5): usa justamente el vehículo que ese día está en taller, así
   * que a ella no se le aplica VEHICULO_EN_TALLER. Ausente = un bloque de operativos.
   */
  esTareaTaller?: boolean;
}

export interface ContextoEvaluacion {
  esFinDeSemana: boolean;
  /** Ventana del nombramiento del conductor (HORA_NOMBRAMIENTO_INICIO a _CONDUCTOR_FIN). */
  ventanaNombramiento: Franja;
  /** Ventana del turno planificado del conductor, si tiene uno con horario (DIA/NOCHE/ECU_NOCHE). */
  ventanaTurno: Franja | null;
}

export interface ParametrosAsignacion {
  maxJornadaHoras: number;
  jornadaAvisoHoras: number;
  descansoMinHoras: number;
  traslado: ParametrosTraslado;
  tablaTraslados: TablaTraslados;
  costoAviso: number;
  costoActivarLibre: number;
  costoArranqueLejos: number;
}

export type CodigoMotivo =
  | 'SOLAPAMIENTO'
  | 'NO_LLEGA'
  | 'NOMBRAMIENTO_FUERA_DE_HORARIO'
  | 'JORNADA_MAXIMA'
  | 'LIBRE_NO_ACTIVADO'
  | 'ASIENTOS'
  | 'VEHICULO_EN_TALLER'
  | 'CONDUCTOR_AUSENTE'
  | 'FUERA_DE_TURNO'
  | 'DESCANSO_INSUFICIENTE'
  | 'JORNADA_LARGA'
  | 'ARRANQUE_LEJOS'
  | 'PATRULLA_DIA_ANTERIOR'
  | 'TOPE_SALIDAS_PESADAS'
  /** AVISO (2026-10-15): el tramo se asigna sin placa. Lo agrega el servicio, no esta política. */
  | 'SIN_VEHICULO'
  /** DURO (2026-10-15): la placa ya está con otro conductor (RN-DAF-01). También del servicio. */
  | 'PLACA_OCUPADA';

export interface Motivo {
  codigo: CodigoMotivo;
  mensaje: string;
}

export interface Evaluacion {
  duros: Motivo[];
  avisos: Motivo[];
  costo: number;
  estado: 'OK' | 'AVISO' | 'DURO';
  /**
   * Minutos de traslado desde el tramo ANTERIOR del conductor (o desde donde amanece su vehículo)
   * hasta el primer tramo del bloque. `null` = no se sabe de dónde viene.
   */
  trasladoPrevioMin: number | null;
  /** Cuánto crece el lapso de su jornada (primer inicio → último fin) al sumar el bloque. */
  ampliacionJornadaMin: number;
}

const horas = (minutos: number): string =>
  `${Math.round((minutos / 60) * 10) / 10} h`;

/** Evalúa si `conductor` (con `vehiculo`) puede tomar `bloque` además de `tramosDelDia`. */
export function evaluar(
  conductor: ConductorEvaluado,
  vehiculo: VehiculoEvaluado | null,
  bloque: BloqueEvaluado,
  tramosDelDia: readonly TramoEvaluado[],
  contexto: ContextoEvaluacion,
  parametros: ParametrosAsignacion,
): Evaluacion {
  const duros: Motivo[] = [];
  const avisos: Motivo[] = [];
  let costo = 0;

  // RN-44 y RN-25, decididas en talento-operativo.
  duros.push(...(bloque.restricciones ?? []));

  if (conductor.ausente) {
    duros.push({
      codigo: 'CONDUCTOR_AUSENTE',
      mensaje: `${conductor.nombre} tiene una ausencia registrada ese día.`,
    });
  }

  // ── Solapamiento ──
  for (const nuevo of bloque.tramos) {
    const choque = tramosDelDia.find((t) => seSolapan(t.franja, nuevo.franja));
    if (choque) {
      duros.push({
        codigo: 'SOLAPAMIENTO',
        mensaje: `Se pisa con ${choque.etiqueta} (${institucional(choque.franja.inicio)} a ${institucional(choque.franja.fin)}).`,
      });
      break;
    }
  }

  // ── No llega por el traslado ── (solo entre un tramo del bloque y uno ya del día)
  const todos = [
    ...tramosDelDia.map((t) => ({ t, delBloque: false })),
    ...bloque.tramos.map((t) => ({ t, delBloque: true })),
  ].sort((a, b) => a.t.franja.inicio - b.t.franja.inicio);
  for (let i = 0; i + 1 < todos.length; i += 1) {
    const a = todos[i];
    const b = todos[i + 1];
    if (a.delBloque === b.delBloque) continue;
    const necesario = minutosTraslado(
      a.t.destino ?? a.t.origen,
      b.t.origen,
      parametros.tablaTraslados,
      parametros.traslado,
    );
    costo += necesario;
    const hueco = b.t.franja.inicio - a.t.franja.fin;
    if (hueco >= 0 && hueco < necesario) {
      duros.push({
        codigo: 'NO_LLEGA',
        mensaje: `No llega: termina ${a.t.etiqueta} a las ${institucional(a.t.franja.fin)} y necesita ${necesario} min de traslado para ${b.t.etiqueta} (${institucional(b.t.franja.inicio)}); el hueco es de ${hueco} min.`,
      });
    }
  }

  // ── Nombramiento: solo dentro de su ventana y en día laborable ──
  if (conductor.tipoContrato === 'NOMBRAMIENTO') {
    const fuera = bloque.tramos.some(
      (t) => !estaDentro(t.franja, contexto.ventanaNombramiento),
    );
    if (contexto.esFinDeSemana || fuera) {
      duros.push({
        codigo: 'NOMBRAMIENTO_FUERA_DE_HORARIO',
        mensaje: `${conductor.nombre} es de nombramiento: trabaja de lunes a viernes de ${institucional(contexto.ventanaNombramiento.inicio)} a ${institucional(contexto.ventanaNombramiento.fin)}.`,
      });
    }
  }

  // ── Jornada ──
  const franjas = todos.map((x) => x.t.franja);
  const primerInicio = Math.min(...franjas.map((f) => f.inicio));
  const ultimoFin = Math.max(...franjas.map((f) => f.fin));
  const jornada = ultimoFin - primerInicio;
  if (jornada > parametros.maxJornadaHoras * 60) {
    duros.push({
      codigo: 'JORNADA_MAXIMA',
      mensaje: `La jornada quedaría en ${horas(jornada)}: supera el máximo de ${parametros.maxJornadaHoras} h.`,
    });
  } else if (jornada > parametros.jornadaAvisoHoras * 60) {
    avisos.push({
      codigo: 'JORNADA_LARGA',
      mensaje: `La jornada quedaría en ${horas(jornada)} (más de ${parametros.jornadaAvisoHoras} h).`,
    });
  }

  // ── Turno ──
  if (conductor.turno === 'LIBRE') {
    costo += parametros.costoActivarLibre;
    if (!conductor.activado) {
      duros.push({
        codigo: 'LIBRE_NO_ACTIVADO',
        mensaje: `${conductor.nombre} está libre ese día: actívelo (horas extra) para asignarle.`,
      });
    } else {
      avisos.push({
        codigo: 'FUERA_DE_TURNO',
        mensaje: `${conductor.nombre} está libre y fue activado: son horas extra.`,
      });
    }
  } else if (conductor.turno === 'ADMINISTRATIVO') {
    avisos.push({
      codigo: 'FUERA_DE_TURNO',
      mensaje: `${conductor.nombre} tiene turno administrativo ese día.`,
    });
  } else if (contexto.ventanaTurno) {
    const ventana = contexto.ventanaTurno;
    if (bloque.tramos.some((t) => !estaDentro(t.franja, ventana))) {
      avisos.push({
        codigo: 'FUERA_DE_TURNO',
        mensaje: `Fuera de su turno (${institucional(ventana.inicio)} a ${institucional(ventana.fin)}): horas extra.`,
      });
    }
  }

  // ── Vehículo ──
  if (vehiculo) {
    if (vehiculo.enTaller && !bloque.esTareaTaller) {
      duros.push({
        codigo: 'VEHICULO_EN_TALLER',
        mensaje: 'El vehículo está en el taller ese día.',
      });
    }
    if (vehiculo.asientos !== null && bloque.personas > vehiculo.asientos) {
      duros.push({
        codigo: 'ASIENTOS',
        mensaje: `Son ${bloque.personas} personas y el vehículo tiene ${vehiculo.asientos} asientos.`,
      });
    }
    // Arranque lejos: solo si el bloque contiene el PRIMER tramo del día.
    const primero = todos[0];
    if (primero?.delBloque && vehiculo.amaneceEn) {
      const minutos = minutosTraslado(
        vehiculo.amaneceEn,
        primero.t.origen,
        parametros.tablaTraslados,
        parametros.traslado,
      );
      if (minutos > parametros.traslado.mismoSector) {
        avisos.push({
          codigo: 'ARRANQUE_LEJOS',
          mensaje: `El vehículo amanece lejos del primer punto (${minutos} min de traslado).`,
        });
        costo += parametros.costoArranqueLejos;
      }
    }
  }

  // ── Descanso desde ayer ──
  if (conductor.ultimoFinAyer !== null) {
    const descanso = primerInicio - conductor.ultimoFinAyer;
    if (descanso < parametros.descansoMinHoras * 60) {
      avisos.push({
        codigo: 'DESCANSO_INSUFICIENTE',
        mensaje: `Descansaría ${horas(Math.max(0, descanso))} desde su último tramo de ayer (mínimo ${parametros.descansoMinHoras} h).`,
      });
    }
  }

  costo += avisos.length * parametros.costoAviso;

  return {
    duros,
    avisos,
    costo,
    estado: duros.length > 0 ? 'DURO' : avisos.length > 0 ? 'AVISO' : 'OK',
    trasladoPrevioMin: trasladoPrevio(
      bloque,
      tramosDelDia,
      vehiculo,
      parametros,
    ),
    ampliacionJornadaMin: ampliacionJornada(bloque, tramosDelDia),
  };
}

/**
 * Continuidad territorial: de dónde llega el conductor al primer tramo del bloque. Desde su último
 * tramo que termina antes; si no tiene ninguno, desde donde amanece su vehículo. Si no se sabe
 * dónde está alguno de los dos lugares, `null` (no 0: un conductor sin origen conocido no debe
 * ganar por «estar cerca»).
 */
function trasladoPrevio(
  bloque: BloqueEvaluado,
  tramosDelDia: readonly TramoEvaluado[],
  vehiculo: VehiculoEvaluado | null,
  parametros: ParametrosAsignacion,
): number | null {
  if (bloque.tramos.length === 0) return null;
  const primero = [...bloque.tramos].sort(
    (a, b) => a.franja.inicio - b.franja.inicio,
  )[0];
  const anteriores = tramosDelDia
    .filter((t) => t.franja.fin <= primero.franja.inicio)
    .sort((a, b) => b.franja.fin - a.franja.fin);
  const desde =
    anteriores.length > 0
      ? (anteriores[0].destino ?? anteriores[0].origen)
      : (vehiculo?.amaneceEn ?? null);
  if (!esConocido(desde) || !esConocido(primero.origen)) return null;
  return minutosTraslado(
    desde,
    primero.origen,
    parametros.tablaTraslados,
    parametros.traslado,
  );
}

/** Un lugar del que se sabe algo: zonal, sector o «conocido sin sector» (un garaje). */
function esConocido(lugar: Lugar | null): lugar is Lugar {
  return (
    lugar !== null &&
    (lugar.zonalId !== null ||
      lugar.sector !== null ||
      lugar.sinSector === true)
  );
}

/** Minutos que el bloque alarga el lapso de la jornada del conductor (0 si cae en un hueco). */
function ampliacionJornada(
  bloque: BloqueEvaluado,
  tramosDelDia: readonly TramoEvaluado[],
): number {
  const lapso = (franjas: readonly Franja[]): number =>
    franjas.length === 0
      ? 0
      : Math.max(...franjas.map((f) => f.fin)) -
        Math.min(...franjas.map((f) => f.inicio));
  const antes = tramosDelDia.map((t) => t.franja);
  return (
    lapso([...antes, ...bloque.tramos.map((t) => t.franja)]) - lapso(antes)
  );
}

/** El fin de un tramo de AYER llevado a la línea de tiempo de HOY. */
export function finDeAyerEnHoy(finEnLineaDeAyer: number): number {
  return finEnLineaDeAyer - MINUTOS_DIA;
}
