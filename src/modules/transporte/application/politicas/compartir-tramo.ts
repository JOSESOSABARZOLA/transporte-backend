/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · compartir unidad
 * Archivo: compartir-tramo.ts
 * Responsabilidad: Decidir si un traslado puede viajar en la MISMA unidad que otro (compartir carro).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA REGLA PARA TRES SITIOS (plan «compartir unidad», 2026-10-19). Hasta hoy la compatibilidad
 * vivía DENTRO del optimizador (`compartir`), y nadie más podía preguntarla. Ahora la usan:
 *
 *   · el optimizador, que comparte como último recurso (mismo resultado que antes);
 *   · el registro del operativo, que sugiere a quien registra viajar con otro de su ámbito
 *     (sobre los tramos PLANIFICADOS, sin asientos: todavía no hay vehículo);
 *   · la DAF, al compartir a mano (con asientos).
 *
 * Las condiciones son las de siempre: ninguno es macrooperativo ni tarea de taller, el MISMO tipo de
 * tramo (dejar con dejar), inicio a ±COMPARTIR_VENTANA_MIN, misma zonal o mismo sector, y —si se
 * evalúa con vehículo— que la placa tenga asientos registrados y quepan todos. El punto de encuentro
 * no entra aquí: lo compara quien busca la coincidencia (el registro).
 *
 * ES PURA. Los mensajes van en palabras del funcionario (regla 8).
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { aHora } from './linea-de-tiempo';
import type { Lugar } from './traslados';

/** Un traslado visto para compartir: su tipo, cuándo empieza (minutos) y desde dónde. */
export interface TramoCompartible {
  /** DEJAR, RETIRAR, COMPLETO o TAREA. */
  tipo: string;
  /** Minutos desde la medianoche del día del operativo. */
  inicio: number;
  /**
   * Minutos del fin (mayor que `inicio`; si cruza la medianoche, sumado un día). Solo lo usa
   * `puedeCompartirOperativo` para saber si dos traslados se CRUZAN; sin él, se supone que sí.
   */
  fin?: number;
  origen: Lugar | null;
  /** El operativo del tramo pide vehículo exclusivo. */
  esMacrooperativo: boolean;
  /**
   * El punto de encuentro del operativo, si se conoce. Solo lo mira la CONTENCIÓN en un «completo»
   * (2026-10-20): la unidad que acompaña un operativo todo el día no se mueve de su punto.
   */
  puntoId?: number | null;
}

/** Lo que ya ocupa la unidad del anfitrión, para el control de asientos. */
export interface CapacidadAnfitrion {
  /** Asientos de la placa; `null` si no están registrados (no se comparte a ciegas). */
  asientos: number | null;
  /** Personas que ya viajan: las del anfitrión y las de quienes comparten con él. */
  ocupados: number;
  /** Personas del operativo que se suma. */
  personasInvitado: number;
}

export type MotivoNoCompartir =
  | 'EXCLUSIVO'
  | 'TAREA_TALLER'
  | 'SIN_TRAMOS'
  | 'TIPO_DISTINTO'
  | 'FUERA_DE_VENTANA'
  | 'OTRO_LUGAR'
  | 'SIN_ASIENTOS'
  | 'SIN_CUPO';

export type ResultadoCompartir =
  | { compatible: true }
  | { compatible: false; codigo: MotivoNoCompartir; motivo: string };

const COMPATIBLE: ResultadoCompartir = { compatible: true };

/** El traslado en palabras: «dejar», «retirar», «acompañar todo el operativo». */
const NOMBRE_TRAMO: Record<string, string> = {
  DEJAR: 'dejar al personal',
  RETIRAR: 'retirar al personal',
  COMPLETO: 'acompañar todo el operativo',
  TAREA: 'una tarea de taller',
};

type NoCompartible = Extract<ResultadoCompartir, { compatible: false }>;

function incompatible(
  codigo: MotivoNoCompartir,
  motivo: string,
): NoCompartible {
  return { compatible: false, codigo, motivo };
}

/** Misma zonal o, si no, mismo sector de la ciudad. Sin lugar conocido no se comparte. */
export function mismoLugar(a: Lugar | null, b: Lugar | null): boolean {
  if (!a || !b) return false;
  if (a.zonalId !== null && a.zonalId === b.zonalId) return true;
  return a.sector !== null && a.sector === b.sector;
}

/**
 * ¿Puede el traslado `invitado` viajar en la unidad del traslado `anfitrion`? Con `capacidad` se
 * comprueban además los asientos (la DAF y el optimizador); sin ella, solo la coincidencia (el
 * registro, que todavía no tiene vehículo).
 */
export function puedeCompartirTramo(
  anfitrion: TramoCompartible,
  invitado: TramoCompartible,
  opciones: { ventanaMin: number; capacidad?: CapacidadAnfitrion },
): ResultadoCompartir {
  if (anfitrion.esMacrooperativo || invitado.esMacrooperativo)
    return incompatible(
      'EXCLUSIVO',
      'Uno de los dos operativos pide vehículo exclusivo (macrooperativo): no comparte unidad.',
    );
  if (anfitrion.tipo !== invitado.tipo)
    return incompatible(
      'TIPO_DISTINTO',
      `No piden el mismo traslado: uno es para ${NOMBRE_TRAMO[invitado.tipo] ?? invitado.tipo} y el otro para ${NOMBRE_TRAMO[anfitrion.tipo] ?? anfitrion.tipo}.`,
    );
  if (Math.abs(anfitrion.inicio - invitado.inicio) > opciones.ventanaMin)
    return incompatible(
      'FUERA_DE_VENTANA',
      `Los traslados empiezan con más de ${opciones.ventanaMin} minutos de diferencia.`,
    );
  if (!mismoLugar(anfitrion.origen, invitado.origen))
    return incompatible(
      'OTRO_LUGAR',
      'Los operativos no están en la misma zonal ni en el mismo sector de la ciudad.',
    );

  const capacidad = opciones.capacidad;
  if (capacidad) {
    if (capacidad.asientos === null)
      return incompatible(
        'SIN_ASIENTOS',
        'La placa no tiene asientos registrados: no se puede saber si caben.',
      );
    const necesarios = capacidad.ocupados + capacidad.personasInvitado;
    if (necesarios > capacidad.asientos)
      return incompatible(
        'SIN_CUPO',
        `No caben: la unidad tiene ${capacidad.asientos} asientos y harían falta ${necesarios}.`,
      );
  }

  return COMPATIBLE;
}

/** Un operativo visto para compartir: sus traslados y si es exclusivo o una tarea de taller. */
export interface OperativoCompartible {
  esMacrooperativo: boolean;
  esTareaTaller?: boolean;
  tramos: TramoCompartible[];
}

/** El traslado en una palabra, para la nota de la pantalla: «dejar», «retirar», «todo el operativo». */
const PALABRA_TRAMO: Record<string, string> = {
  DEJAR: 'dejar',
  RETIRAR: 'retirar',
  COMPLETO: 'todo el operativo',
  TAREA: 'una tarea de taller',
};

export function palabraDeTramo(tipo: string): string {
  return PALABRA_TRAMO[tipo] ?? tipo.toLowerCase();
}

/**
 * ¿Se cruzan dos traslados en el reloj? Sin el fin de alguno no se puede saber, y se supone que sí
 * (no se ofrece «después» lo que quizá choca).
 */
export function seCruzan(a: TramoCompartible, b: TramoCompartible): boolean {
  if (a.fin === undefined || b.fin === undefined) return true;
  return a.inicio < b.fin && b.inicio < a.fin;
}

/**
 * Resultado de un operativo frente a otro (2026-10-19, «la misma unidad»): con qué traslados
 * viaja en la unidad del anfitrión (`tramosCompartidos`) y cuáles le quedan PROPIOS (sin pareja y
 * sin cruzarse con la unidad: los hará la misma unidad después, si su agenda lo permite).
 */
export type ResultadoCompartirOperativo =
  | {
      compatible: true;
      tramosCompartidos: TramoCompartible[];
      tramosPropios: TramoCompartible[];
      /**
       * Traslados que se CRUZAN con la unidad y van con ella porque uno es «completo» (2026-10-20):
       * el del invitado cae dentro del «completo» de la unidad (`DENTRO`), o el «completo» del
       * invitado abarca los traslados de la unidad (`ABARCA`). Ver `contiene`.
       */
      tramosContenidos: {
        tramo: TramoCompartible;
        sentido: SentidoContencion;
      }[];
    }
  | { compatible: false; codigo: MotivoNoCompartir; motivo: string };

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA MISMA UNIDAD, NO LOS MISMOS TRASLADOS (2026-10-19, aclaración del negocio). Lo que se comparte
 * es el CONDUCTOR CON SU VEHÍCULO. Un «dejar y retirar» B junto a un «solo dejar» A: al dejar, la
 * unidad lleva a A y a B juntos; después queda libre y puede volver por B para el retiro. Por eso
 * basta con que AL MENOS UN traslado del invitado tenga pareja en el anfitrión: ese viaja
 * compartido; los demás quedan como PROPIOS del invitado (la DAF decide si los hace la misma
 * unidad, con la política completa). Sin asientos: es la comprobación del registro.
 *
 * TRES CLASES DE TRASLADO (2026-10-19, «retirar es otro estado»). Un «solo retirar» de las 16:00
 * junto a un «solo dejar» de las 08:00 no viaja junto, pero tampoco choca: la misma unidad deja a
 * uno y vuelve después por el otro. Cada traslado del invitado es:
 *   · COMPARTIDO: tiene pareja en la unidad (`puedeCompartirTramo`): viajan juntos.
 *   · SECUENCIAL: no se cruza con ningún traslado de la unidad: la misma unidad lo hace después
 *     (va a `tramosPropios`; la DAF lo valida con la política completa: traslados, jornada…).
 *   · CONFLICTO: se cruza con un traslado de la unidad y no puede ir con él (otro tipo, otra hora,
 *     otro lugar): la unidad no puede estar en los dos sitios.
 * Compatible ⇔ ningún CONFLICTO. Si lo hay, su motivo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function puedeCompartirOperativo(
  anfitrion: OperativoCompartible,
  invitado: OperativoCompartible,
  opciones: { ventanaMin: number },
): ResultadoCompartirOperativo {
  if (anfitrion.esMacrooperativo || invitado.esMacrooperativo)
    return incompatible(
      'EXCLUSIVO',
      'Uno de los dos operativos pide vehículo exclusivo (macrooperativo): no comparte unidad.',
    );
  if (anfitrion.esTareaTaller || invitado.esTareaTaller)
    return incompatible(
      'TAREA_TALLER',
      'Una tarea de taller no comparte unidad.',
    );
  if (invitado.tramos.length === 0 || anfitrion.tramos.length === 0)
    return incompatible(
      'SIN_TRAMOS',
      'Uno de los dos operativos no pide transporte de la DAF.',
    );

  const tramosCompartidos: TramoCompartible[] = [];
  const tramosPropios: TramoCompartible[] = [];
  const tramosContenidos: {
    tramo: TramoCompartible;
    sentido: SentidoContencion;
  }[] = [];
  let conflicto: NoCompartible | null = null;
  for (const tramo of invitado.tramos) {
    const clase = clasificarTramo(tramo, anfitrion.tramos, opciones);
    if (clase.clase === 'COMPARTIDO') tramosCompartidos.push(tramo);
    else if (clase.clase === 'SECUENCIAL') tramosPropios.push(tramo);
    else if (clase.clase === 'CONTENIDO')
      tramosContenidos.push({ tramo, sentido: clase.sentido });
    // Entre varios conflictos, explica mejor el que SÍ tenía un traslado del mismo tipo (falló por
    // la hora o el lugar) que el que no lo tenía.
    else if (!conflicto || conflicto.codigo === 'TIPO_DISTINTO')
      conflicto = clase.motivo;
  }
  if (conflicto) return conflicto;
  return {
    compatible: true,
    tramosCompartidos,
    tramosPropios,
    tramosContenidos,
  };
}

/**
 * Cómo va un traslado con un «completo» de la unidad (2026-10-20): DENTRO = el del invitado cae en
 * el horario del «completo» de la unidad; ABARCA = el «completo» del invitado cubre traslados de la
 * unidad.
 */
export type SentidoContencion = 'DENTRO' | 'ABARCA';

/** Lo que es un traslado del invitado frente a la unidad del anfitrión (ver arriba). */
export type ClaseDeTramo =
  | { clase: 'COMPARTIDO'; pareja: TramoCompartible }
  | { clase: 'SECUENCIAL' }
  | {
      clase: 'CONTENIDO';
      sentido: SentidoContencion;
      /** El «completo» que lo contiene (DENTRO) o el primer traslado que abarca (ABARCA). */
      pareja: TramoCompartible;
      /** Los traslados de la unidad con los que se cruza (para saber qué cruza). */
      cruzados: TramoCompartible[];
    }
  | { clase: 'CONFLICTO'; motivo: NoCompartible };

/**
 * Mismo sitio en sentido ESTRICTO (2026-10-20): misma zonal —el sector no basta— y, si los dos
 * traen punto de encuentro, el mismo. La unidad que acompaña un operativo todo el día no se mueve
 * de allí: solo puede dejar o retirar a otros en ese mismo sitio.
 */
export function mismoSitio(a: TramoCompartible, b: TramoCompartible): boolean {
  if (!a.origen || !b.origen) return false;
  if (a.origen.zonalId === null || a.origen.zonalId !== b.origen.zonalId)
    return false;
  const puntoA = a.puntoId ?? null;
  const puntoB = b.puntoId ?? null;
  return puntoA === null || puntoB === null || puntoA === puntoB;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LA UNIDAD QUE ACOMPAÑA TODO EL OPERATIVO TAMBIÉN DEJA Y RETIRA (2026-10-20, a pedido del
 * negocio). Un «completo» tiene su conductor y su vehículo en el punto de encuentro de principio a
 * fin; si en ese mismo sitio otro operativo pide que dejen a su personal al inicio o que lo retiren
 * al final, esa misma unidad lo hace sin moverse. ¿`completo` contiene a `otro`?
 *   · `completo` es un «completo» y `otro` es un dejar o un retirar (2026-10-21: otro «completo»
 *     no; dos operativos que se acompañan todo el día comparten solo si empiezan juntos, COMPARTIDO);
 *   · ninguno es exclusivo (macrooperativo);
 *   · `otro` cae dentro del horario de `completo`, con ±ventanaMin en los bordes;
 *   · mismo sitio estricto (`mismoSitio`).
 * Los asientos NO van aquí: los cuenta quien conoce las personas (`encajarEnUnidad`, por momento).
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function contiene(
  completo: TramoCompartible,
  otro: TramoCompartible,
  ventanaMin: number,
): boolean {
  if (completo.tipo !== 'COMPLETO') return false;
  if (otro.tipo !== 'DEJAR' && otro.tipo !== 'RETIRAR') return false;
  if (completo.esMacrooperativo || otro.esMacrooperativo) return false;
  if (completo.fin === undefined || otro.fin === undefined) return false;
  if (otro.inicio < completo.inicio - ventanaMin) return false;
  if (otro.fin > completo.fin + ventanaMin) return false;
  return mismoSitio(completo, otro);
}

/** Por qué un «completo» y un traslado que se cruzan no van en la misma unidad. */
function motivoSinContencion(
  completo: TramoCompartible,
  otro: TramoCompartible,
): NoCompartible {
  if (completo.esMacrooperativo || otro.esMacrooperativo)
    return incompatible(
      'EXCLUSIVO',
      'Uno de los dos operativos pide vehículo exclusivo (macrooperativo): no comparte unidad.',
    );
  if (!mismoSitio(completo, otro))
    return incompatible(
      'OTRO_LUGAR',
      'La unidad que acompaña todo el operativo no se mueve de su punto: el otro traslado es en otra zonal o en otro punto de encuentro.',
    );
  return incompatible(
    'FUERA_DE_VENTANA',
    'El traslado no cae dentro del horario del operativo completo que acompaña esa unidad.',
  );
}

/**
 * Clasifica UN traslado del invitado contra los de la unidad: con pareja (compartido), dentro de
 * un «completo» o abarcándolos (contenido, 2026-10-20), sin cruce (secuencial) o con un cruce que
 * no se puede compartir (conflicto, con el motivo del traslado del MISMO tipo si lo hay: dice qué
 * falla de verdad). Con `capacidad`, la pareja exige asientos.
 */
export function clasificarTramo(
  tramo: TramoCompartible,
  unidad: readonly TramoCompartible[],
  opciones: { ventanaMin: number; capacidad?: CapacidadAnfitrion },
): ClaseDeTramo {
  let fallo: NoCompartible | null = null;
  for (const candidato of unidad) {
    const resultado = puedeCompartirTramo(candidato, tramo, opciones);
    if (resultado.compatible) return { clase: 'COMPARTIDO', pareja: candidato };
    if (!seCruzan(candidato, tramo)) continue;
    if (!fallo || candidato.tipo === tramo.tipo) fallo = resultado;
  }
  if (!fallo) return { clase: 'SECUENCIAL' };

  // Se cruza con algo y no hay pareja del mismo tipo: ¿lo resuelve un «completo»?
  const cruzados = unidad.filter((c) => seCruzan(c, tramo));
  const juntos = (a: TramoCompartible, b: TramoCompartible): boolean =>
    puedeCompartirTramo(a, b, { ventanaMin: opciones.ventanaMin }).compatible;
  const v = opciones.ventanaMin;

  // DENTRO: el traslado cae en un «completo» de la unidad, y lo demás que cruza está en ese mismo
  // «completo» (la unidad está allí) o viaja junto con él.
  const contenedor = cruzados.find((c) => contiene(c, tramo, v));
  if (
    contenedor &&
    cruzados.every(
      (c) => c === contenedor || contiene(contenedor, c, v) || juntos(c, tramo),
    )
  )
    return {
      clase: 'CONTENIDO',
      sentido: 'DENTRO',
      pareja: contenedor,
      cruzados,
    };

  // ABARCA: el «completo» del invitado cubre todo lo que la unidad hace en su horario.
  if (
    tramo.tipo === 'COMPLETO' &&
    cruzados.every((c) => contiene(tramo, c, v) || juntos(c, tramo))
  )
    return {
      clase: 'CONTENIDO',
      sentido: 'ABARCA',
      pareja: cruzados[0],
      cruzados,
    };

  // Con un «completo» de por medio, el motivo es el de la contención (otro sitio, fuera de hora).
  const conCompleto =
    tramo.tipo === 'COMPLETO'
      ? cruzados.find((c) => !contiene(tramo, c, v) && !juntos(c, tramo))
      : cruzados.find((c) => c.tipo === 'COMPLETO');
  if (conCompleto && fallo.codigo === 'TIPO_DISTINTO')
    fallo =
      tramo.tipo === 'COMPLETO'
        ? motivoSinContencion(tramo, conCompleto)
        : motivoSinContencion(conCompleto, tramo);
  return { clase: 'CONFLICTO', motivo: fallo };
}

// ─────────────────────────── Encajar un operativo en una unidad ───────────────────────────

/** Un traslado que ya hace la unidad (conductor + placa), con su grupo y su operativo. */
export interface TramoDeLaUnidad extends TramoCompartible {
  id: number;
  fin: number;
  /** El operativo del tramo (para los asientos de cada momento); `null` = una TAREA. */
  operativoId: number | null;
  /** El tramo raíz con el que viaja; `null` si es raíz. */
  compartidoConTramoId: number | null;
}

/** Un traslado del operativo que se suma a la unidad. */
export interface TramoQueSeSuma extends TramoCompartible {
  id: number;
  fin: number;
}

export interface OpcionesEncaje {
  ventanaMin: number;
  /** Asientos de la placa; `null` si no están registrados (no se comparte a ciegas). */
  asientos: number | null;
  /** Personas de cada operativo. */
  personasDe: (operativoId: number) => number;
  /**
   * Los funcionarios de cada operativo, para contar PERSONAS DISTINTAS (quien va en dos operativos
   * del grupo ocupa un solo asiento). Sin él, se suman las personas de cada operativo.
   */
  funcionariosDe?: (operativoId: number) => readonly number[];
  /**
   * Todo lo que la unidad hace hoy (conductor + placa). Sin él, `unidad`. Puede traer más que
   * `unidad`: dice quién viaja con cada raíz del grupo.
   */
  aBordo?: readonly TramoDeLaUnidad[];
}

export type ResultadoEncaje =
  | {
      compatible: true;
      /** Cada traslado que viaja con la unidad y la raíz del grupo al que entra. */
      pares: {
        tramoId: number;
        raizId: number;
        clase: 'COMPARTIDO' | 'CONTENIDO';
        sentido: SentidoContencion | null;
      }[];
      /** Los «completos» del invitado que abarcan la unidad: pasan a ser la RAÍZ del grupo. */
      raices: number[];
      /** Traslados que no se cruzan con la unidad (los hace después, si su agenda lo permite). */
      sinPareja: { tramoId: number; tipo: string }[];
      /** Tramos de la unidad que pasan al grupo de un «completo» invitado. */
      reraizar: { tramoId: number; raizId: number }[];
      /** Las personas del momento más lleno con el invitado (sin el conductor). */
      personas: number;
      /** Cada momento en que viaja el invitado, con las personas a bordo (uno por tipo). */
      momentos: MomentoDeLaUnidad[];
    }
  | NoCompartible;

/**
 * Las personas distintas de unos operativos: por funcionario si se conocen (quien va en dos
 * operativos ocupa un asiento); si no, la suma de las de cada operativo.
 */
export function personasDistintas(
  operativoIds: readonly number[],
  opciones: Pick<OpcionesEncaje, 'personasDe' | 'funcionariosDe'>,
): number {
  const ids = [...new Set(operativoIds)];
  const { funcionariosDe } = opciones;
  if (funcionariosDe)
    return new Set(ids.flatMap((id) => [...funcionariosDe(id)])).size;
  return ids.reduce((suma, id) => suma + opciones.personasDe(id), 0);
}

/** El mensaje de una unidad sin sitio en un momento (`minuto`, si se conoce). */
export function mensajeSinCupo(
  personas: number,
  asientos: number,
  minuto?: number,
): string {
  const cuando = minuto === undefined ? '' : ` a las ${aHora(minuto)}`;
  return `No caben${cuando}: la unidad llevaría ${personas} ${personas === 1 ? 'persona' : 'personas'} y el vehículo tiene ${asientos} ${asientos === 1 ? 'asiento' : 'asientos'}.`;
}

/** Un traslado a bordo de la unidad, para contar quién va en cada momento. */
export interface TramoConPersonas {
  id: number;
  tipo: string;
  inicio: number;
  fin: number;
  /** `null` = una TAREA (no lleva personal). */
  operativoId: number | null;
}

/** Un momento de la unidad: qué traslado lo marca, cuándo y cuántas personas van a bordo. */
export interface MomentoDeLaUnidad {
  tramoId: number;
  tipo: string;
  inicio: number;
  personas: number;
}

/**
 * ¿Va a bordo en ese minuto? Un dejar o un retirar, durante su traslado; un «completo», todo su
 * horario con ±ventanaMin en los bordes (el dejar y el retirar que contiene caben en esa holgura).
 */
function aBordoEn(
  tramo: Pick<TramoConPersonas, 'tipo' | 'inicio' | 'fin'>,
  minuto: number,
  ventanaMin: number,
): boolean {
  const holgura = tramo.tipo === 'COMPLETO' ? ventanaMin : 0;
  return tramo.inicio - holgura <= minuto && minuto < tramo.fin + holgura;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOS ASIENTOS SE CUENTAN POR MOMENTO (2026-10-21, decisión del negocio). En cada momento en que
 * viaja el invitado —el inicio de cada traslado de la unidad mientras él va a bordo— se cuentan las
 * personas DISTINTAS de los operativos a bordo en ese minuto: el «completo» durante todo su
 * horario, cada dejar y cada retirar solo durante su traslado. El conductor no cuenta; quien va en
 * dos operativos ocupa un asiento. Ej. (21-OCT): a las 08:00 van el «completo» y los dos dejar (3);
 * a las 16:00, el «completo» y los dos retirar (3): con 3 asientos caben los cuatro operativos.
 * Devuelve un momento por tipo de traslado (el más lleno), en orden de hora.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function personasPorMomento(
  tramos: readonly TramoConPersonas[],
  invitado: readonly Pick<TramoConPersonas, 'tipo' | 'inicio' | 'fin'>[],
  opciones: Pick<
    OpcionesEncaje,
    'ventanaMin' | 'personasDe' | 'funcionariosDe'
  >,
): MomentoDeLaUnidad[] {
  const v = opciones.ventanaMin;
  const unicos = [...new Map(tramos.map((t) => [t.id, t])).values()];
  const puntos = unicos
    .filter((t) => invitado.some((s) => aBordoEn(s, t.inicio, v)))
    .sort((a, b) => a.inicio - b.inicio);
  const porTipo = new Map<string, MomentoDeLaUnidad>();
  for (const punto of puntos) {
    const operativos = unicos
      .filter((u) => u.operativoId !== null && aBordoEn(u, punto.inicio, v))
      .map((u) => u.operativoId as number);
    const personas = personasDistintas(operativos, opciones);
    // El inicio de un «completo» que coincide con un dejar se nombra por el dejar.
    const mismoMinuto = unicos.find(
      (u) => u.tipo !== 'COMPLETO' && u.inicio === punto.inicio,
    );
    const tipo =
      punto.tipo === 'COMPLETO' && mismoMinuto ? mismoMinuto.tipo : punto.tipo;
    const previo = porTipo.get(tipo);
    if (!previo || personas > previo.personas)
      porTipo.set(tipo, {
        tramoId: punto.id,
        tipo,
        inicio: punto.inicio,
        personas,
      });
  }
  return [...porTipo.values()].sort((a, b) => a.inicio - b.inicio);
}

/** Las personas del momento más lleno de unos traslados de la unidad (0 si no lleva a nadie). */
export function maximoAbordo(
  tramos: readonly TramoConPersonas[],
  opciones: Pick<
    OpcionesEncaje,
    'ventanaMin' | 'personasDe' | 'funcionariosDe'
  >,
): number {
  return Math.max(
    0,
    ...personasPorMomento(tramos, tramos, opciones).map((m) => m.personas),
  );
}

/** La raíz del grupo de un tramo de la unidad. */
function raizDe(tramo: TramoDeLaUnidad): number {
  return tramo.compartidoConTramoId ?? tramo.id;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ENCAJAR UN OPERATIVO EN UNA UNIDAD (2026-10-21). La regla única de «compartir unidad», la que usan
 * la DAF a mano (`emparejar`), la asignación de varios operativos de una vez, el optimizador y su
 * confirmación. Cada traslado del invitado frente a la unidad (`clasificarTramo`) es:
 *   · COMPARTIDO: viaja con un traslado del mismo tipo y hora → entra al grupo de ese traslado;
 *   · CONTENIDO DENTRO: cae dentro de un «completo» de la unidad → entra al grupo del «completo»;
 *   · CONTENIDO ABARCA: el «completo» del invitado cubre lo que la unidad hace en su horario →
 *     EL «COMPLETO» PASA A SER LA RAÍZ, y todo lo cubierto (con quienes viajaban con ello) se
 *     re-enraíza a él. El que acompaña el operativo todo el día es el dueño de la unidad, sin
 *     importar en qué orden llegaron los traslados;
 *   · SECUENCIAL: no se cruza → `sinPareja`;
 *   · CONFLICTO: incompatible, con su motivo.
 * ASIENTOS POR MOMENTO (2026-10-21, decisión del negocio, `personasPorMomento`): en cada momento en
 * que viaja el invitado, las personas distintas a bordo —el «completo», el dejar o el retirar de ese
 * momento y el propio invitado— no pasan de los asientos de la placa. El conductor no cuenta.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function encajarEnUnidad(
  invitado: { operativoId: number; tramos: readonly TramoQueSeSuma[] },
  unidad: readonly TramoDeLaUnidad[],
  opciones: OpcionesEncaje,
): ResultadoEncaje {
  if (invitado.tramos.some((t) => t.esMacrooperativo))
    return incompatible(
      'EXCLUSIVO',
      'Uno de los dos operativos pide vehículo exclusivo (macrooperativo): no comparte unidad.',
    );
  if (invitado.tramos.length === 0 || unidad.length === 0)
    return incompatible(
      'SIN_TRAMOS',
      'Ese operativo no tiene un traslado asignado con el que compartir.',
    );
  const aBordo = opciones.aBordo ?? unidad;

  const pares: Extract<ResultadoEncaje, { compatible: true }>['pares'] = [];
  const raices: number[] = [];
  const sinPareja: { tramoId: number; tipo: string }[] = [];
  const reraizar = new Map<number, number>();
  let conflicto: NoCompartible | null = null;
  const anotar = (fallo: NoCompartible): void => {
    if (!conflicto || conflicto.codigo === 'TIPO_DISTINTO') conflicto = fallo;
  };

  for (const tramo of invitado.tramos) {
    const clase = clasificarTramo(tramo, unidad, {
      ventanaMin: opciones.ventanaMin,
    });
    if (clase.clase === 'SECUENCIAL') {
      sinPareja.push({ tramoId: tramo.id, tipo: tramo.tipo });
      continue;
    }
    if (clase.clase === 'CONFLICTO') {
      anotar(clase.motivo);
      continue;
    }
    const pareja = clase.pareja as TramoDeLaUnidad;
    if (clase.clase === 'COMPARTIDO' || clase.sentido === 'DENTRO') {
      pares.push({
        tramoId: tramo.id,
        raizId: raizDe(pareja),
        clase: clase.clase,
        sentido: clase.clase === 'CONTENIDO' ? clase.sentido : null,
      });
      continue;
    }
    // ABARCA: el «completo» del invitado pasa a ser la raíz de lo que cubre.
    const cubiertos = clase.cruzados as TramoDeLaUnidad[];
    raices.push(tramo.id);
    // Todo el grupo de lo cubierto (y quien viajaba con ello) pasa a ser del «completo».
    const grupos = new Set(cubiertos.map((c) => raizDe(c)));
    for (const t of [...unidad, ...aBordo])
      if (grupos.has(raizDe(t)) || grupos.has(t.id))
        reraizar.set(t.id, tramo.id);
  }
  if (conflicto) return conflicto;

  // ASIENTOS POR MOMENTO: todo lo que la unidad lleva mientras el invitado va a bordo.
  const momentos = personasPorMomento(
    [
      ...unidad,
      ...aBordo,
      ...invitado.tramos.map((t) => ({
        ...t,
        operativoId: invitado.operativoId,
      })),
    ],
    invitado.tramos,
    opciones,
  );
  const lleno = momentos.reduce<MomentoDeLaUnidad | null>(
    (max, m) => (max === null || m.personas > max.personas ? m : max),
    null,
  );
  const personas = lleno?.personas ?? 0;
  if (opciones.asientos === null) {
    if (pares.length > 0 || raices.length > 0)
      return incompatible(
        'SIN_ASIENTOS',
        'La placa no tiene asientos registrados: no se puede saber si caben.',
      );
  } else if (lleno && personas > opciones.asientos)
    return incompatible(
      'SIN_CUPO',
      mensajeSinCupo(personas, opciones.asientos, lleno.inicio),
    );
  return {
    compatible: true,
    personas,
    momentos,
    pares,
    raices,
    sinPareja,
    reraizar: [...reraizar.entries()].map(([tramoId, raizId]) => ({
      tramoId,
      raizId,
    })),
  };
}

// ─────────────────────────── La unidad compartida como UN intervalo ───────────────────────────

/**
 * Lo mínimo de un tramo para saber con quién comparte unidad: su id y, si viaja con otro, el tramo
 * ANFITRIÓN (`trtr_compartido_con_id`). `undefined` vale como «no comparte» (filas antiguas).
 */
export interface TramoDeUnidad {
  id: number;
  compartidoConTramoId?: number | null;
}

/** El grupo de una unidad compartida: el id del anfitrión (el propio, si no viaja con nadie). */
export function claveDeUnidad(tramo: TramoDeUnidad): number {
  return tramo.compartidoConTramoId ?? tramo.id;
}

/**
 * `ids` más los tramos que comparten unidad con alguno de ellos (2026-10-19). Al evaluar un tramo
 * que ya viaja en una unidad compartida, el resto del grupo no es «otro tramo del día»: es el mismo
 * viaje. Sin esto, el anfitrión y su invitado se verían como un SOLAPAMIENTO entre sí.
 */
export function conSuUnidad(
  ids: ReadonlySet<number>,
  tramos: readonly TramoDeUnidad[],
): Set<number> {
  const claves = new Set(
    tramos.filter((t) => ids.has(t.id)).map((t) => claveDeUnidad(t)),
  );
  const resultado = new Set(ids);
  for (const tramo of tramos)
    if (claves.has(claveDeUnidad(tramo))) resultado.add(tramo.id);
  return resultado;
}

/** Un tramo de la agenda con su grupo de unidad, para fundirlo. */
export interface TramoEnUnidad<
  T extends { franja: { inicio: number; fin: number } },
> {
  clave: number;
  tramo: T;
}

/**
 * La agenda de un conductor con cada unidad compartida como UN SOLO intervalo (2026-10-19): el
 * anfitrión y sus invitados son el mismo viaje, así que para SOLAPAMIENTO, NO_LLEGA, la jornada
 * (D8) y las horas libres cuentan una vez, del primer inicio al último fin del grupo. Se conserva
 * el primero del grupo (su origen y su etiqueta) y el destino del que termina más tarde.
 */
export function agendaPorUnidad<
  T extends {
    franja: { inicio: number; fin: number };
    destino?: unknown;
  },
>(tramos: readonly TramoEnUnidad<T>[]): T[] {
  const grupos = new Map<number, T[]>();
  for (const { clave, tramo } of tramos) {
    const lista = grupos.get(clave) ?? [];
    lista.push(tramo);
    grupos.set(clave, lista);
  }
  const resultado: T[] = [];
  for (const lista of grupos.values()) {
    if (lista.length === 1) {
      resultado.push(lista[0]);
      continue;
    }
    const porInicio = [...lista].sort(
      (a, b) => a.franja.inicio - b.franja.inicio,
    );
    const ultimo = [...lista].sort((a, b) => b.franja.fin - a.franja.fin)[0];
    resultado.push({
      ...porInicio[0],
      franja: { inicio: porInicio[0].franja.inicio, fin: ultimo.franja.fin },
      destino: ultimo.destino ?? porInicio[0].destino,
    });
  }
  return resultado.sort((a, b) => a.franja.inicio - b.franja.inicio);
}
