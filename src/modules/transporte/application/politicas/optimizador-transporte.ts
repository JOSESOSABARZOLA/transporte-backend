/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · optimizador «Cubrir al máximo»
 * Archivo: optimizador-transporte.ts
 * Responsabilidad: Proponer qué conductor y vehículo cubre cada bloque pendiente del día.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * EL OBJETIVO ES CUBRIR LA MAYOR CANTIDAD DE OPERATIVOS, no repartir bonito. La analista de la DAF
 * llena huecos a mano; esto le da una PROPUESTA (no guarda nada) que ella revisa y confirma.
 *
 * INSERCIÓN VORAZ POR BLOQUE con varias ESTRATEGIAS, y gana la que más cubre:
 *   · orden de los bloques: por DIFICULTAD (los que tienen menos candidatos viables primero, para no
 *     gastar en otro el único conductor que les sirve) o por HORA de inicio;
 *   · conductores LIBRES: NO usarlos, usarlos como RESPALDO (solo si ningún conductor de turno
 *     sirve) o MEZCLADOS con los demás por costo.
 * Desempate: más operativos cubiertos → menos libres activados → menos avisos → menor costo. Como
 * hay estrategias SIN libres, un libre solo se activa si con él se cubre más (regla de la DAF: los
 * libres son horas extra).
 *
 * CADA CANDIDATO SE EVALÚA CON LA POLÍTICA (`asignacion-conductor.policy.ts`) contra los tramos
 * que ya acumuló en ESA estrategia, así que solapamientos, traslados, jornada y descanso se
 * respetan igual que en la asignación a mano. Lo ya asignado a mano es FIJO: nunca se toca.
 *
 * VEHÍCULO: el que el conductor ya usa ese día; si no, el que se llevó a su casa (dónde amanece) o
 * su habitual; si no, el más chico en el que caben las personas. Nunca una placa en dos conductores
 * a la vez, nunca uno en taller (salvo la TAREA de llevarlo). Si el que ya usa hoy está en el
 * taller (p. ej. lo llevó él), se le busca otro (G6, 2026-10-15); por otra razón, no se le cambia.
 *
 * ENTRE LOS CANDIDATOS VIABLES DE UN BLOQUE GANA, EN ESTE ORDEN ESTRICTO (2026-10-14):
 *   1. CONTINUIDAD TERRITORIAL — menos minutos de traslado desde su tramo anterior (o desde donde
 *      amanece su vehículo). Sin origen conocido va AL FINAL: no gana por «estar a 0 minutos».
 *   2. APROVECHAR UN HUECO — menos minutos que se alarga su jornada; 0 = cae en un hueco que ya
 *      tiene, antes que gastar a un conductor sin asignaciones.
 *   3. MISMO VEHÍCULO — el que ya usa hoy, luego el que se llevó a casa, luego su habitual.
 *   4. ASIENTOS — el vehículo más ajustado a las personas.
 *   5. El costo (avisos, libres, arranque lejos) y, por último, el id.
 * Entre ESTRATEGIAS el desempate no cambia (más cubiertos primero), así que este orden no puede
 * bajar la cobertura de la estrategia ganadora.
 *
 * RN-44 Y RN-25 (descanso del conductor) llegan HECHAS por bloque y conductor en
 * `bloque.restricciones`: las decide `talento-operativo`, aquí solo se aplican como DUROS.
 *
 * COMPARTIR CARRO (si se pide), para lo que siga sin conductor: misma zonal o sector, inicio a
 * ±COMPARTIR_VENTANA_MIN, mismo tipo de tramo, NINGUNO macrooperativo y caben las personas. Lo que
 * aún quede es «sin recurso», con el motivo que más se repite entre los conductores.
 *
 * EL «COMPLETO» DEJA Y RETIRA EN SU PUNTO (2026-10-21, con «compartir carro»). Un bloque de dejar
 * y retirar cuyos traslados caen TODOS dentro de un «completo» del mismo punto (misma zonal y mismo
 * punto de encuentro, los dos conocidos) se reparte DESPUÉS del resto y va primero en la unidad de
 * ese «completo» (la que pidió quien registró, si la pidió): la regla única `encajarEnUnidad`, con
 * los asientos de cada momento, y la política contra lo que el conductor hace FUERA del grupo. Si
 * ninguna unidad lo admite, se asigna como siempre. Sin un «completo» del mismo punto, nada cambia.
 *
 * ES PURA: sin base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  evaluar,
  type ConductorEvaluado,
  type Evaluacion,
  type Motivo,
  type ParametrosAsignacion,
  type TramoEvaluado,
  type VehiculoEvaluado,
} from './asignacion-conductor.policy';
import { seSolapan, type Franja } from './linea-de-tiempo';
import {
  contiene,
  encajarEnUnidad,
  personasPorMomento,
  puedeCompartirTramo,
  type MomentoDeLaUnidad,
  type TramoDeLaUnidad,
  type TramoQueSeSuma,
} from './compartir-tramo';

/**
 * Macrooperativo (2026-10-07). Motivo, en palabras del funcionario, por el que no se comparte el
 * vehículo con un operativo que pide vehículo exclusivo. Lo usan el optimizador y la confirmación.
 */
export const MOTIVO_VEHICULO_EXCLUSIVO = 'Operativo con vehículo exclusivo';

/** Un bloque pendiente: los tramos sin conductor de una cadena (o una TAREA). */
export interface BloqueOptimizable {
  clave: string;
  tramoIds: number[];
  /** Alineado con `tramoIds`. */
  tramos: TramoEvaluado[];
  /** Tipo de cada tramo (DEJAR/RETIRAR/COMPLETO/TAREA), alineado con `tramoIds`. */
  tipos: string[];
  operativoIds: number[];
  personas: number;
  esMacrooperativo: boolean;
  esTareaTaller: boolean;
  /** La TAREA de taller trae su vehículo; un bloque de operativos, `null`. */
  vehiculoFijoId: number | null;
  /** RN-44 y RN-25 por conductor (id → motivos), ya decididas. Ausente o sin clave = ninguna. */
  restricciones?: ReadonlyMap<number, readonly Motivo[]>;
  /**
   * Compartir unidad (2026-10-19): quien registró pidió viajar con ESTE operativo. Si se comparte
   * carro, se intenta primero con él (prioridad suave). Ausente o `null` = sin pedido.
   */
  compartirConOperativoId?: number | null;
  /**
   * El punto de encuentro de cada tramo, alineado con `tramoIds` («completo» que deja y retira,
   * 2026-10-21). Ausente o `null` = no se sabe: el bloque no se contiene en un «completo».
   */
  puntoIds?: (number | null)[];
}

export interface ConductorOptimizable {
  conductor: ConductorEvaluado;
  /** Ventana de su turno planificado (DIA/NOCHE/ECU_NOCHE), si tiene. */
  ventanaTurno: Franja | null;
  /** El vehículo que se llevó a su domicilio anoche: mañana se le repite. */
  vehiculoLlevadoId: number | null;
  vehiculoHabitualId: number | null;
}

/** Un tramo ya asignado (a mano): fijo, no se mueve. */
export interface TramoFijo {
  tramoId: number;
  conductorId: number;
  vehiculoId: number | null;
  tramo: TramoEvaluado;
  tipo: string;
  personas: number;
  esMacrooperativo: boolean;
  /** El operativo del tramo (para el pedido de compartir unidad). `null` = una TAREA. */
  operativoId?: number | null;
  /** El punto de encuentro de su operativo (2026-10-21). */
  puntoId?: number | null;
  /** El tramo raíz con el que ya viaja, si comparte unidad. */
  compartidoConTramoId?: number | null;
}

export interface OpcionesOptimizador {
  activarLibres: boolean;
  compartirCarro: boolean;
}

export interface EntradaOptimizador {
  bloques: BloqueOptimizable[];
  conductores: ConductorOptimizable[];
  vehiculos: VehiculoEvaluado[];
  fijos: TramoFijo[];
  contexto: { esFinDeSemana: boolean; ventanaNombramiento: Franja };
  parametros: ParametrosAsignacion & { compartirVentanaMin: number };
  opciones: OpcionesOptimizador;
  /** Operativos que ya tienen todos sus tramos cubiertos (cuentan en «cubiertos» y «total»). */
  operativosYaCubiertos: number;
}

export interface AsignacionPropuesta {
  clave: string;
  tramoIds: number[];
  operativoIds: number[];
  conductorId: number;
  vehiculoId: number | null;
  avisos: Motivo[];
}

export interface SinRecurso {
  clave: string;
  operativoIds: number[];
  tramoIds: number[];
  motivo: string;
}

export interface Propuesta {
  estrategia: string;
  cubiertos: number;
  total: number;
  asignaciones: AsignacionPropuesta[];
  activaciones: { conductorId: number; motivo: string }[];
  compartidos: { tramoId: number; compartidoConTramoId: number }[];
  sinRecurso: SinRecurso[];
  avisos: number;
  costo: number;
}

type OrdenBloques = 'DIFICULTAD' | 'HORA';
type UsoLibres = 'SIN_LIBRES' | 'RESPALDO' | 'MEZCLADOS';

interface Estrategia {
  orden: OrdenBloques;
  libres: UsoLibres;
}

/** Lo que una estrategia va acumulando. */
interface Estado {
  tramosDe: Map<number, TramoEvaluado[]>;
  vehiculoDe: Map<number, number>;
  /** Placas en el taller ese día (G6): la «de hoy» que entra al taller no ata al conductor. */
  enTaller: Set<number>;
  /** Ocupación de cada placa: quién la usa y en qué franja. */
  placas: { vehiculoId: number; conductorId: number; franja: Franja }[];
  activados: Set<number>;
  asignaciones: AsignacionPropuesta[];
  avisos: number;
  costo: number;
  /** Lo que hace cada unidad (conductor + placa), para contener dejar y retirar en un «completo». */
  enUnidad: TramoEnUnidad[];
  /** Personas por la clave numérica de cada operativo o bloque (asientos de cada momento). */
  personas: Map<number, number>;
}

/** Un traslado de una unidad en la estrategia: el fijo o el ya repartido. */
interface TramoEnUnidad {
  conductorId: number;
  vehiculoId: number | null;
  operativoIds: number[];
  puro: TramoDeLaUnidad;
  /** El mismo objeto que está en `tramosDe`, o `null` si viaja dentro de otro (no está allí). */
  evaluado: TramoEvaluado | null;
}

/** La clave numérica de un bloque para los asientos (negativa: no choca con un operativo). */
function claveDeBloque(
  entrada: EntradaOptimizador,
  bloque: BloqueOptimizable,
): number {
  return -(1_000_000 + entrada.bloques.indexOf(bloque));
}

/** El tramo i del bloque visto por la regla pura de compartir. */
function puroDeBloque(bloque: BloqueOptimizable, i: number): TramoQueSeSuma {
  const tramo = bloque.tramos[i];
  return {
    id: bloque.tramoIds[i],
    tipo: bloque.tipos[i],
    inicio: tramo.franja.inicio,
    fin: tramo.franja.fin,
    origen: tramo.origen,
    esMacrooperativo: bloque.esMacrooperativo,
    puntoId: bloque.puntoIds?.[i] ?? null,
  };
}

interface Candidato {
  conductorId: number;
  vehiculoId: number | null;
  /** 0 = el que ya usa hoy, 1 = el que se llevó a casa, 2 = su habitual, 3 = otro. */
  rangoVehiculo: number;
  /** Asientos que sobran con las personas del bloque; `null` = asientos no registrados. */
  asientosSobrantes: number | null;
  evaluacion: Evaluacion;
  activa: boolean;
}

/** `null` al final en un orden ascendente. */
const nulosAlFinal = (a: number | null, b: number | null): number =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;

/** El orden estricto de la cabecera: continuidad, hueco, vehículo, asientos, costo, id. */
function compararCandidatos(a: Candidato, b: Candidato): number {
  return (
    nulosAlFinal(
      a.evaluacion.trasladoPrevioMin,
      b.evaluacion.trasladoPrevioMin,
    ) ||
    a.evaluacion.ampliacionJornadaMin - b.evaluacion.ampliacionJornadaMin ||
    a.rangoVehiculo - b.rangoVehiculo ||
    nulosAlFinal(a.asientosSobrantes, b.asientosSobrantes) ||
    a.evaluacion.costo - b.evaluacion.costo ||
    a.conductorId - b.conductorId
  );
}

const NOMBRE_ESTRATEGIA: Record<OrdenBloques, string> = {
  DIFICULTAD: 'por dificultad',
  HORA: 'por hora',
};
const NOMBRE_LIBRES: Record<UsoLibres, string> = {
  SIN_LIBRES: 'sin activar libres',
  RESPALDO: 'libres como respaldo',
  MEZCLADOS: 'libres mezclados por costo',
};

/** La propuesta que más cubre, entre todas las estrategias. */
export function optimizar(entrada: EntradaOptimizador): Propuesta {
  const usos: UsoLibres[] = entrada.opciones.activarLibres
    ? ['SIN_LIBRES', 'RESPALDO', 'MEZCLADOS']
    : ['SIN_LIBRES'];
  const estrategias: Estrategia[] = (['DIFICULTAD', 'HORA'] as const).flatMap(
    (orden) => usos.map((libres) => ({ orden, libres })),
  );

  let mejor: Propuesta | null = null;
  for (const estrategia of estrategias) {
    const propuesta = ejecutar(entrada, estrategia);
    if (!mejor || esMejor(propuesta, mejor)) mejor = propuesta;
  }
  return mejor as Propuesta;
}

/** 0 = primero. El macrooperativo (vehículo exclusivo) se reparte antes que el resto. */
function prioridadDe(bloque: BloqueOptimizable): number {
  return bloque.esMacrooperativo ? 0 : 1;
}

function esMejor(a: Propuesta, b: Propuesta): boolean {
  if (a.cubiertos !== b.cubiertos) return a.cubiertos > b.cubiertos;
  if (a.activaciones.length !== b.activaciones.length)
    return a.activaciones.length < b.activaciones.length;
  if (a.avisos !== b.avisos) return a.avisos < b.avisos;
  return a.costo < b.costo;
}

function estadoInicial(entrada: EntradaOptimizador): Estado {
  const estado: Estado = {
    tramosDe: new Map(),
    vehiculoDe: new Map(),
    enTaller: new Set(
      entrada.vehiculos.filter((v) => v.enTaller).map((v) => v.id),
    ),
    placas: [],
    activados: new Set(
      entrada.conductores
        .filter((c) => c.conductor.activado)
        .map((c) => c.conductor.id),
    ),
    asignaciones: [],
    avisos: 0,
    costo: 0,
    enUnidad: [],
    personas: new Map(),
  };
  for (const fijo of entrada.fijos) {
    const clave = fijo.operativoId ?? -fijo.tramoId;
    estado.personas.set(clave, fijo.personas);
    estado.enUnidad.push({
      conductorId: fijo.conductorId,
      vehiculoId: fijo.vehiculoId,
      operativoIds:
        fijo.operativoId === null || fijo.operativoId === undefined
          ? []
          : [fijo.operativoId],
      puro: {
        id: fijo.tramoId,
        tipo: fijo.tipo,
        inicio: fijo.tramo.franja.inicio,
        fin: fijo.tramo.franja.fin,
        origen: fijo.tramo.origen,
        esMacrooperativo: fijo.esMacrooperativo,
        puntoId: fijo.puntoId ?? null,
        operativoId: clave,
        compartidoConTramoId: fijo.compartidoConTramoId ?? null,
      },
      evaluado: fijo.tramo,
    });
    const lista = estado.tramosDe.get(fijo.conductorId) ?? [];
    lista.push(fijo.tramo);
    estado.tramosDe.set(fijo.conductorId, lista);
    if (fijo.vehiculoId !== null) {
      if (!estado.vehiculoDe.has(fijo.conductorId))
        estado.vehiculoDe.set(fijo.conductorId, fijo.vehiculoId);
      estado.placas.push({
        vehiculoId: fijo.vehiculoId,
        conductorId: fijo.conductorId,
        franja: fijo.tramo.franja,
      });
    }
  }
  return estado;
}

function ejecutar(
  entrada: EntradaOptimizador,
  estrategia: Estrategia,
): Propuesta {
  const estado = estadoInicial(entrada);

  const orden = [...entrada.bloques];
  // Macrooperativo (2026-10-07): pide vehículo EXCLUSIVO y es prioritario. En toda estrategia se
  // reparte ANTES que el resto, así que cuando compite por el mismo conductor o vehículo lo gana.
  if (estrategia.orden === 'HORA') {
    orden.sort(
      (a, b) =>
        prioridadDe(a) - prioridadDe(b) ||
        inicioDe(a) - inicioDe(b) ||
        a.clave.localeCompare(b.clave),
    );
  } else {
    // Dificultad = cuántos conductores podrían tomarlo con el día vacío (antes de repartir).
    const vacio = estadoInicial(entrada);
    const viables = new Map(
      orden.map((b) => [
        b.clave,
        candidatosDe(
          b,
          entrada,
          vacio,
          estrategia.libres === 'SIN_LIBRES' ? 'SIN_LIBRES' : 'MEZCLADOS',
        ).length,
      ]),
    );
    orden.sort(
      (a, b) =>
        prioridadDe(a) - prioridadDe(b) ||
        (viables.get(a.clave) ?? 0) - (viables.get(b.clave) ?? 0) ||
        inicioDe(a) - inicioDe(b) ||
        a.clave.localeCompare(b.clave),
    );
  }

  // Compartir unidad (2026-10-19, prioridad SUAVE): lo que quien registró pidió compartir con otro
  // operativo se reparte DESPUÉS del resto, para que su anfitrión ya tenga conductor; entonces se
  // intenta primero viajar con él y, si la regla pura no lo deja, se asigna como siempre. Sin
  // pedidos (o sin «compartir carro»), la lista está vacía y el resultado no cambia.
  // El «completo» deja y retira en su punto (2026-10-21): lo contenible va después, en esa unidad.
  const contenibles = entrada.opciones.compartirCarro
    ? orden.filter((b) => esContenible(b, entrada))
    : [];
  const preferidos = entrada.opciones.compartirCarro
    ? orden.filter(
        (b) =>
          b.compartirConOperativoId !== null &&
          b.compartirConOperativoId !== undefined &&
          !b.esMacrooperativo &&
          !b.esTareaTaller &&
          !contenibles.includes(b),
      )
    : [];
  const pendientes: BloqueOptimizable[] = [];
  for (const bloque of orden) {
    if (preferidos.includes(bloque) || contenibles.includes(bloque)) continue;
    const elegido = elegir(bloque, entrada, estado, estrategia.libres);
    if (elegido) aplicar(bloque, elegido, estado, entrada);
    else pendientes.push(bloque);
  }

  const compartidos: { tramoId: number; compartidoConTramoId: number }[] = [];
  const compartidosBloques = new Set<string>();
  for (const bloque of contenibles) {
    const pares = contener(bloque, entrada, estado);
    if (pares) {
      compartidos.push(...pares);
      compartidosBloques.add(bloque.clave);
      continue;
    }
    const elegido = elegir(bloque, entrada, estado, estrategia.libres);
    if (elegido) aplicar(bloque, elegido, estado, entrada);
    else pendientes.push(bloque);
  }
  for (const bloque of preferidos) {
    const pares = compartir(
      bloque,
      entrada,
      estado,
      bloque.compartirConOperativoId ?? undefined,
    );
    if (pares) {
      compartidos.push(...pares);
      compartidosBloques.add(bloque.clave);
      continue;
    }
    const elegido = elegir(bloque, entrada, estado, estrategia.libres);
    if (elegido) aplicar(bloque, elegido, estado, entrada);
    else pendientes.push(bloque);
  }

  // Compartir carro con lo ya asignado, si se pidió.
  if (entrada.opciones.compartirCarro) {
    for (const bloque of pendientes) {
      const pares = compartir(bloque, entrada, estado);
      if (pares) {
        compartidos.push(...pares);
        compartidosBloques.add(bloque.clave);
      }
    }
  }

  const sinRecurso = pendientes
    .filter((b) => !compartidosBloques.has(b.clave))
    .map((b) => ({
      clave: b.clave,
      operativoIds: b.operativoIds,
      tramoIds: b.tramoIds,
      motivo: motivoDominante(b, entrada, estado),
    }));

  const operativosNuevos = new Set<number>();
  for (const a of estado.asignaciones)
    a.operativoIds.forEach((id) => operativosNuevos.add(id));
  for (const b of [...pendientes, ...preferidos, ...contenibles])
    if (compartidosBloques.has(b.clave))
      b.operativoIds.forEach((id) => operativosNuevos.add(id));
  // Un operativo con algún bloque aún sin recurso no está cubierto del todo.
  for (const s of sinRecurso)
    s.operativoIds.forEach((id) => operativosNuevos.delete(id));

  const operativosPendientes = new Set<number>();
  entrada.bloques.forEach((b) =>
    b.operativoIds.forEach((id) => operativosPendientes.add(id)),
  );

  const activaciones = [...estado.activados]
    .filter(
      (id) =>
        !entrada.conductores.find((c) => c.conductor.id === id)?.conductor
          .activado,
    )
    .map((conductorId) => ({
      conductorId,
      motivo:
        'Activado por el optimizador para cubrir operativos sin conductor (horas extra).',
    }));

  return {
    estrategia: `${NOMBRE_ESTRATEGIA[estrategia.orden]}, ${NOMBRE_LIBRES[estrategia.libres]}`,
    cubiertos: entrada.operativosYaCubiertos + operativosNuevos.size,
    total: entrada.operativosYaCubiertos + operativosPendientes.size,
    asignaciones: estado.asignaciones,
    activaciones,
    compartidos,
    sinRecurso,
    avisos: estado.avisos,
    costo: estado.costo,
  };
}

function inicioDe(bloque: BloqueOptimizable): number {
  return Math.min(...bloque.tramos.map((t) => t.franja.inicio));
}

/** El candidato de menor costo, según cómo se usen los libres. */
function elegir(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
  libres: UsoLibres,
): Candidato | null {
  const mejorDe = (lista: Candidato[]): Candidato | null =>
    lista.sort(compararCandidatos)[0] ?? null;

  if (libres === 'RESPALDO') {
    return (
      mejorDe(candidatosDe(bloque, entrada, estado, 'SIN_LIBRES')) ??
      mejorDe(candidatosDe(bloque, entrada, estado, 'SOLO_LIBRES'))
    );
  }
  return mejorDe(candidatosDe(bloque, entrada, estado, libres));
}

type Filtro = UsoLibres | 'SOLO_LIBRES';

/** Los candidatos viables (sin DUROS) para un bloque, con su vehículo. */
function candidatosDe(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
  filtro: Filtro,
): Candidato[] {
  const resultado: Candidato[] = [];
  for (const c of entrada.conductores) {
    const esLibre = c.conductor.turno === 'LIBRE';
    const activado = estado.activados.has(c.conductor.id);
    // Un libre YA activado (a mano o en esta estrategia) cuenta como uno más; activar uno nuevo solo
    // se permite si la estrategia usa libres.
    if (filtro === 'SIN_LIBRES' && esLibre && !activado) continue;
    if (filtro === 'SOLO_LIBRES' && !esLibre) continue;

    const eleccion = vehiculoPara(c, bloque, entrada, estado);
    if (eleccion === undefined) continue; // sin vehículo posible
    const vehiculoId = eleccion.id;
    const vehiculo =
      vehiculoId === null
        ? null
        : (entrada.vehiculos.find((v) => v.id === vehiculoId) ?? null);
    const evaluacion = evaluar(
      { ...c.conductor, activado: activado || esLibre },
      vehiculo,
      {
        tramos: bloque.tramos,
        personas: bloque.personas,
        esTareaTaller: bloque.esTareaTaller,
        restricciones: bloque.restricciones?.get(c.conductor.id),
      },
      estado.tramosDe.get(c.conductor.id) ?? [],
      { ...entrada.contexto, ventanaTurno: c.ventanaTurno },
      entrada.parametros,
    );
    if (evaluacion.estado === 'DURO') continue;
    resultado.push({
      conductorId: c.conductor.id,
      vehiculoId,
      rangoVehiculo: eleccion.rango,
      asientosSobrantes:
        vehiculo?.asientos == null ? null : vehiculo.asientos - bloque.personas,
      evaluacion,
      activa: esLibre && !activado,
    });
  }
  return resultado;
}

/**
 * El vehículo con el que el conductor tomaría el bloque, con su rango de preferencia (0 = el que ya
 * usa hoy … 3 = otro): `id: null` = TAREA sin vehículo (no ocurre), `undefined` = ninguno posible.
 */
function vehiculoPara(
  c: ConductorOptimizable,
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
): { id: number | null; rango: number } | undefined {
  const franjas = bloque.tramos.map((t) => t.franja);
  const libre = (vehiculoId: number): boolean =>
    !estado.placas.some(
      (p) =>
        p.vehiculoId === vehiculoId &&
        p.conductorId !== c.conductor.id &&
        franjas.some((f) => seSolapan(f, p.franja)),
    );

  if (bloque.vehiculoFijoId !== null) {
    return libre(bloque.vehiculoFijoId)
      ? { id: bloque.vehiculoFijoId, rango: 0 }
      : undefined;
  }

  const sirve = (vehiculoId: number | null | undefined): boolean => {
    if (vehiculoId === null || vehiculoId === undefined) return false;
    const v = entrada.vehiculos.find((x) => x.id === vehiculoId);
    if (!v || v.enTaller) return false;
    if (v.asientos !== null && v.asientos < bloque.personas) return false;
    return libre(vehiculoId);
  };

  // El que ya usa hoy manda: un conductor no cambia de carro a mitad de jornada, SALVO que ese
  // carro esté en el taller (G6, 2026-10-15): entonces se le busca otro como a cualquiera.
  const actual = estado.vehiculoDe.get(c.conductor.id);
  if (actual !== undefined) {
    if (sirve(actual)) return { id: actual, rango: 0 };
    if (!estado.enTaller.has(actual)) return undefined;
  }

  const preferidos = [c.vehiculoLlevadoId, c.vehiculoHabitualId];
  for (const [indice, preferido] of preferidos.entries()) {
    if (sirve(preferido)) return { id: preferido as number, rango: indice + 1 };
  }
  const otros = entrada.vehiculos
    .filter((v) => sirve(v.id))
    .sort(
      (a, b) =>
        (a.asientos ?? Number.MAX_SAFE_INTEGER) -
          (b.asientos ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
    );
  return otros[0] ? { id: otros[0].id, rango: 3 } : undefined;
}

function aplicar(
  bloque: BloqueOptimizable,
  elegido: Candidato,
  estado: Estado,
  entrada: EntradaOptimizador,
): void {
  const lista = estado.tramosDe.get(elegido.conductorId) ?? [];
  lista.push(...bloque.tramos);
  estado.tramosDe.set(elegido.conductorId, lista);
  if (!bloque.esTareaTaller) {
    const clave = claveDeBloque(entrada, bloque);
    estado.personas.set(clave, bloque.personas);
    bloque.tramos.forEach((tramo, i) =>
      estado.enUnidad.push({
        conductorId: elegido.conductorId,
        vehiculoId: elegido.vehiculoId,
        operativoIds: bloque.operativoIds,
        puro: {
          ...puroDeBloque(bloque, i),
          operativoId: clave,
          compartidoConTramoId: null,
        },
        evaluado: tramo,
      }),
    );
  }
  if (elegido.vehiculoId !== null) {
    const actual = estado.vehiculoDe.get(elegido.conductorId);
    if (
      !bloque.esTareaTaller &&
      (actual === undefined || estado.enTaller.has(actual))
    )
      estado.vehiculoDe.set(elegido.conductorId, elegido.vehiculoId);
    for (const t of bloque.tramos) {
      estado.placas.push({
        vehiculoId: elegido.vehiculoId,
        conductorId: elegido.conductorId,
        franja: t.franja,
      });
    }
  }
  if (elegido.activa) estado.activados.add(elegido.conductorId);
  estado.asignaciones.push({
    clave: bloque.clave,
    tramoIds: bloque.tramoIds,
    operativoIds: bloque.operativoIds,
    conductorId: elegido.conductorId,
    vehiculoId: elegido.vehiculoId,
    avisos: elegido.evaluacion.avisos,
  });
  estado.avisos += elegido.evaluacion.avisos.length;
  estado.costo += elegido.evaluacion.costo;
}

/** Un tramo «anfitrión» ya cubierto con el que se puede compartir carro. */
interface Anfitrion {
  tramoId: number;
  /** De qué operativos es (para el pedido de compartir unidad). */
  operativoIds: number[];
  tramo: TramoEvaluado;
  tipo: string;
  vehiculoId: number | null;
  personas: number;
  esMacrooperativo: boolean;
}

function anfitriones(entrada: EntradaOptimizador, estado: Estado): Anfitrion[] {
  const lista: Anfitrion[] = entrada.fijos.map((f) => ({
    tramoId: f.tramoId,
    operativoIds:
      f.operativoId === null || f.operativoId === undefined
        ? []
        : [f.operativoId],
    tramo: f.tramo,
    tipo: f.tipo,
    vehiculoId: f.vehiculoId,
    personas: f.personas,
    esMacrooperativo: f.esMacrooperativo,
  }));
  for (const a of estado.asignaciones) {
    const bloque = entrada.bloques.find((b) => b.clave === a.clave);
    if (!bloque || bloque.esTareaTaller) continue;
    bloque.tramoIds.forEach((tramoId, i) =>
      lista.push({
        tramoId,
        operativoIds: bloque.operativoIds,
        tramo: bloque.tramos[i],
        tipo: bloque.tipos[i],
        vehiculoId: a.vehiculoId,
        personas: bloque.personas,
        esMacrooperativo: bloque.esMacrooperativo,
      }),
    );
  }
  return lista;
}

/**
 * Empareja cada tramo del bloque con un anfitrión compatible, o `null` si alguno no tiene. Con
 * `soloConOperativo` (el pedido de compartir unidad), solo se mira a ese operativo.
 */
function compartir(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
  soloConOperativo?: number,
): { tramoId: number; compartidoConTramoId: number }[] | null {
  if (bloque.esMacrooperativo || bloque.esTareaTaller) return null;
  const candidatos = anfitriones(entrada, estado).filter(
    (h) =>
      soloConOperativo === undefined ||
      h.operativoIds.includes(soloConOperativo),
  );
  const pares: { tramoId: number; compartidoConTramoId: number }[] = [];
  const unidadDe = new Map<number, Anfitrion>();

  for (let i = 0; i < bloque.tramos.length; i += 1) {
    const tramo = bloque.tramos[i];
    // La compatibilidad es la regla pura compartida (2026-10-19): la misma que usan el registro y
    // la DAF al compartir a mano. Aquí, con asientos: el anfitrión ya tiene placa.
    const anfitrion = candidatos.find((h) => {
      const v = entrada.vehiculos.find((x) => x.id === h.vehiculoId);
      return puedeCompartirTramo(
        {
          tipo: h.tipo,
          inicio: h.tramo.franja.inicio,
          origen: h.tramo.origen,
          esMacrooperativo: h.esMacrooperativo,
        },
        {
          tipo: bloque.tipos[i],
          inicio: tramo.franja.inicio,
          origen: tramo.origen,
          esMacrooperativo: bloque.esMacrooperativo,
        },
        {
          ventanaMin: entrada.parametros.compartirVentanaMin,
          capacidad: {
            // Los asientos de cada momento se cuentan después, con toda la unidad.
            asientos: v ? v.asientos : null,
            ocupados: 0,
            personasInvitado: bloque.personas,
          },
        },
      ).compatible;
    });
    if (!anfitrion) return null;
    unidadDe.set(i, anfitrion);
    pares.push({
      tramoId: bloque.tramoIds[i],
      compartidoConTramoId: anfitrion.tramoId,
    });
  }

  // ASIENTOS POR MOMENTO (2026-10-21): en cada unidad que lo lleva, lo que va a bordo mientras
  // viaja el bloque (`personasPorMomento`, la misma regla que la DAF a mano).
  const clave = claveDeBloque(entrada, bloque);
  const llaveDe = (conductorId: number, vehiculoId: number | null): string =>
    `${conductorId}|${vehiculoId ?? ''}`;
  const conductorDe = (h: Anfitrion): number | null =>
    estado.enUnidad.find((u) => u.puro.id === h.tramoId)?.conductorId ?? null;
  const porUnidad = new Map<
    string,
    { conductorId: number; vehiculoId: number | null; indices: number[] }
  >();
  for (const [i, h] of unidadDe) {
    const conductorId = conductorDe(h);
    if (conductorId === null) continue;
    const llave = llaveDe(conductorId, h.vehiculoId);
    const una = porUnidad.get(llave) ?? {
      conductorId,
      vehiculoId: h.vehiculoId,
      indices: [],
    };
    una.indices.push(i);
    porUnidad.set(llave, una);
  }
  for (const una of porUnidad.values()) {
    const asientos =
      una.vehiculoId === null
        ? null
        : (entrada.vehiculos.find((x) => x.id === una.vehiculoId)?.asientos ??
          null);
    if (asientos === null) continue;
    const propios = una.indices.map((i) => ({
      ...puroDeBloque(bloque, i),
      operativoId: clave,
    }));
    estado.personas.set(clave, bloque.personas);
    const lleno = maximoEn(
      personasPorMomento(
        [
          ...estado.enUnidad
            .filter(
              (u) =>
                llaveDe(u.conductorId, u.vehiculoId) ===
                llaveDe(una.conductorId, una.vehiculoId),
            )
            .map((u) => u.puro),
          ...propios,
        ],
        propios,
        {
          ventanaMin: entrada.parametros.compartirVentanaMin,
          personasDe: (id) => estado.personas.get(id) ?? 0,
        },
      ),
    );
    if (lleno > asientos) {
      estado.personas.delete(clave);
      return null;
    }
  }

  // El bloque viaja en esas unidades: lo que lleven después también cuenta sus personas.
  estado.personas.set(clave, bloque.personas);
  for (const [i, h] of unidadDe) {
    const conductorId = conductorDe(h);
    if (conductorId === null) continue;
    estado.enUnidad.push({
      conductorId,
      vehiculoId: h.vehiculoId,
      operativoIds: bloque.operativoIds,
      puro: {
        ...puroDeBloque(bloque, i),
        operativoId: clave,
        compartidoConTramoId: raizDeTramo(h.tramoId, estado),
      },
      evaluado: null,
    });
  }
  return pares;
}

/** Las personas del momento más lleno (0 si no hay momentos). */
function maximoEn(momentos: readonly MomentoDeLaUnidad[]): number {
  return Math.max(0, ...momentos.map((m) => m.personas));
}

/** La raíz del grupo de un tramo de la estrategia (el propio, si no viaja dentro de otro). */
function raizDeTramo(tramoId: number, estado: Estado): number {
  const t = estado.enUnidad.find((u) => u.puro.id === tramoId);
  return t?.puro.compartidoConTramoId ?? tramoId;
}

/**
 * ¿Caen TODOS los traslados del bloque (dejar o retirar) dentro de un «completo» del día en el mismo
 * punto conocido? Es lo que decide si el bloque se intenta primero en la unidad de ese «completo».
 */
function esContenible(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
): boolean {
  if (bloque.esMacrooperativo || bloque.esTareaTaller) return false;
  if (!bloque.tipos.every((t) => t === 'DEJAR' || t === 'RETIRAR'))
    return false;
  const ventana = entrada.parametros.compartirVentanaMin;
  const completos: TramoQueSeSuma[] = [
    ...entrada.fijos
      .filter((f) => f.tipo === 'COMPLETO')
      .map((f) => ({
        id: f.tramoId,
        tipo: f.tipo,
        inicio: f.tramo.franja.inicio,
        fin: f.tramo.franja.fin,
        origen: f.tramo.origen,
        esMacrooperativo: f.esMacrooperativo,
        puntoId: f.puntoId ?? null,
      })),
    ...entrada.bloques
      .filter((b) => b !== bloque)
      .flatMap((b) =>
        b.tipos.flatMap((tipo, i) =>
          tipo === 'COMPLETO' ? [puroDeBloque(b, i)] : [],
        ),
      ),
  ];
  return bloque.tipos.every((_, i) => {
    const tramo = puroDeBloque(bloque, i);
    return (
      tramo.puntoId !== null &&
      completos.some(
        (c) => c.puntoId === tramo.puntoId && contiene(c, tramo, ventana),
      )
    );
  });
}

/**
 * Lleva el bloque en la unidad de un «completo» que lo contiene (2026-10-21): la que pidió quien
 * registró primero, después las demás. Cada unidad se prueba con la regla única
 * (`encajarEnUnidad`, asientos por momento) y con la política del conductor contra lo que hace
 * FUERA del grupo. Devuelve los pares (tramo → raíz del grupo) o `null` si ninguna lo admite.
 */
function contener(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
): { tramoId: number; compartidoConTramoId: number }[] | null {
  const clave = claveDeBloque(entrada, bloque);
  const tramos = bloque.tipos.map((_, i) => puroDeBloque(bloque, i));
  // Las personas del bloque cuentan en los asientos de sus momentos aunque aún no viaje.
  estado.personas.set(clave, bloque.personas);
  const unidades = new Map<string, TramoEnUnidad[]>();
  for (const t of estado.enUnidad) {
    const llave = `${t.conductorId}|${t.vehiculoId ?? ''}`;
    unidades.set(llave, [...(unidades.get(llave) ?? []), t]);
  }
  const pedido = bloque.compartirConOperativoId ?? null;
  const loPidio = (u: TramoEnUnidad[]): number =>
    Number(pedido !== null && u.some((t) => t.operativoIds.includes(pedido)));
  const candidatas = [...unidades.values()]
    .filter((u) =>
      u.some(
        (t) =>
          t.puro.tipo === 'COMPLETO' && t.puro.puntoId === tramos[0].puntoId,
      ),
    )
    .sort(
      (a, b) => loPidio(b) - loPidio(a) || a[0].conductorId - b[0].conductorId,
    );

  for (const unidad of candidatas) {
    const { conductorId, vehiculoId } = unidad[0];
    const vehiculo =
      vehiculoId === null
        ? null
        : (entrada.vehiculos.find((v) => v.id === vehiculoId) ?? null);
    const resultado = encajarEnUnidad(
      { operativoId: clave, tramos },
      unidad.map((t) => t.puro),
      {
        ventanaMin: entrada.parametros.compartirVentanaMin,
        asientos: vehiculo?.asientos ?? null,
        personasDe: (id) => estado.personas.get(id) ?? 0,
      },
    );
    if (
      !resultado.compatible ||
      resultado.sinPareja.length > 0 ||
      resultado.raices.length > 0
    )
      continue;

    // La política, contra lo que el conductor hace FUERA del grupo (el grupo es el mismo viaje).
    const grupos = new Set(resultado.pares.map((p) => p.raizId));
    const delGrupo = new Set(
      unidad
        .filter((t) => grupos.has(t.puro.compartidoConTramoId ?? t.puro.id))
        .map((t) => t.evaluado),
    );
    const c = entrada.conductores.find((x) => x.conductor.id === conductorId);
    if (!c) continue;
    const evaluacion = evaluar(
      { ...c.conductor, activado: estado.activados.has(conductorId) },
      vehiculo,
      {
        tramos: bloque.tramos,
        personas: bloque.personas,
        esTareaTaller: false,
        restricciones: bloque.restricciones?.get(conductorId),
      },
      (estado.tramosDe.get(conductorId) ?? []).filter((t) => !delGrupo.has(t)),
      { ...entrada.contexto, ventanaTurno: c.ventanaTurno },
      entrada.parametros,
    );
    if (evaluacion.estado === 'DURO') continue;

    const raizDe = new Map(resultado.pares.map((p) => [p.tramoId, p.raizId]));
    for (const t of tramos)
      estado.enUnidad.push({
        conductorId,
        vehiculoId,
        operativoIds: bloque.operativoIds,
        puro: {
          ...t,
          operativoId: clave,
          compartidoConTramoId: raizDe.get(t.id) ?? null,
        },
        evaluado: null,
      });
    return resultado.pares.map((p) => ({
      tramoId: p.tramoId,
      compartidoConTramoId: p.raizId,
    }));
  }
  return null;
}

/** El motivo DURO que más se repite entre los conductores, para explicar el «sin recurso». */
function motivoDominante(
  bloque: BloqueOptimizable,
  entrada: EntradaOptimizador,
  estado: Estado,
): string {
  if (entrada.conductores.length === 0)
    return 'No hay conductores activos ese día.';
  const conteo = new Map<string, { veces: number; mensaje: string }>();
  let sinVehiculo = 0;
  for (const c of entrada.conductores) {
    const esLibre = c.conductor.turno === 'LIBRE';
    const activado = estado.activados.has(c.conductor.id);
    const eleccion = vehiculoPara(c, bloque, entrada, estado);
    if (eleccion === undefined) {
      sinVehiculo += 1;
      continue;
    }
    const vehiculoId = eleccion.id;
    const vehiculo =
      vehiculoId === null
        ? null
        : (entrada.vehiculos.find((v) => v.id === vehiculoId) ?? null);
    const evaluacion = evaluar(
      {
        ...c.conductor,
        activado: activado || (esLibre && entrada.opciones.activarLibres),
      },
      vehiculo,
      {
        tramos: bloque.tramos,
        personas: bloque.personas,
        esTareaTaller: bloque.esTareaTaller,
        restricciones: bloque.restricciones?.get(c.conductor.id),
      },
      estado.tramosDe.get(c.conductor.id) ?? [],
      { ...entrada.contexto, ventanaTurno: c.ventanaTurno },
      entrada.parametros,
    );
    for (const duro of evaluacion.duros) {
      const previo = conteo.get(duro.codigo);
      conteo.set(duro.codigo, {
        veces: (previo?.veces ?? 0) + 1,
        mensaje: previo?.mensaje ?? duro.mensaje,
      });
    }
  }
  const dominante = [...conteo.entries()].sort(
    (a, b) => b[1].veces - a[1].veces,
  )[0];
  if (!dominante || sinVehiculo > dominante[1].veces)
    return 'No hay un vehículo libre en el que quepan las personas a esa hora.';
  return `Sin conductor disponible (${dominante[1].veces} de ${entrada.conductores.length}): ${dominante[1].mensaje}`;
}
