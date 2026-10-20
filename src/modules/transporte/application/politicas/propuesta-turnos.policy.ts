/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: propuesta-turnos.policy.ts
 * Responsabilidad: Proponer el mes entero de turnos de los conductores, con mínimos, descanso y reparto.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * «PROPONER EL MES». Es la versión de flota de «Continuar rotación»: además de prolongar el ciclo
 * de cada conductor, cubre los MÍNIMOS por día de la semana, respeta el DESCANSO y reparte noches y
 * fines de semana. NO ESCRIBE: devuelve propuestas; aplicarlas es el lote de siempre.
 *
 * 1 · EL CICLO DE CADA CONDUCTOR, en este orden (gana el primero que exista):
 *     a. HISTORIAL: el período más corto p ∈ [2, 14] con el que todos los días conocidos (los
 *        anteriores al mes y, si no se rehace, los ya guardados del mes) que distan un múltiplo de
 *        p coinciden, con cada fase conocida y al menos dos vueltas de evidencia (2p días).
 *     b. PATRÓN del conductor (`cond_patron_rotacion`), en la fase que más coincide con lo conocido
 *        (empate → la menor); sin nada conocido, el día 1 del mes es la primera letra.
 *     c. ÚLTIMOS 14 DÍAS: se repite la quincena anterior al mes tal cual; sus huecos quedan huecos.
 *     Sin ninguno de los tres, el conductor no tiene ciclo: solo se le propone para cubrir mínimos.
 * 2 · NUNCA SE ESCRIBE SOBRE UNA AUSENCIA, y solo se llenan las celdas VACÍAS salvo `rehacerTodo`
 *     (que reescribe también los turnos guardados del mes, nunca las ausencias).
 * 3 · DESCANSO, día por día: con DAF_PERMITE_NOCHE_A_DIA = NO no se propone DÍA tras NOCHE/ECU
 *     NOCHE (ni NOCHE antes de un DÍA ya guardado); con DAF_MAX_DIAS_SIN_LIBRE = n no se propone un
 *     turno de trabajo que alargue la racha por encima de n. Lo que el ciclo pedía y no se puede se
 *     cambia por LIBRE y se avisa. Una regla SIN CONFIGURAR no se evalúa.
 * 4 · MÍNIMOS (DAF_MIN_CONDUCTORES_DIA/NOCHE, L..D): si el día queda corto se suman conductores
 *     con la celda llenable sin turno de trabajo —primero los sin ciclo, luego los LIBRE—, eligiendo
 *     al que MENOS lleva de ese turno (y de fines de semana, si es sábado o domingo); empate → menor
 *     id. Si aun así no alcanza, el día va a `diasBajoMinimo`. La noche cuenta NOCHE + ECU_NOCHE.
 * 5 · REPARTO: al final, entre los conductores con algún turno de trabajo en el mes, si la diferencia
 *     de noches o de fines de semana trabajados es > 1 se avisa al que más lleva.
 *
 * ES PURA Y DETERMINISTA: misma entrada, misma salida; no lee la base ni el reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

export type TurnoMes =
  | 'DIA'
  | 'NOCHE'
  | 'ECU_NOCHE'
  | 'LIBRE'
  | 'ADMINISTRATIVO';

/** Un día de la secuencia de un conductor: un turno, vacío o ausencia. */
export type CeldaMes = TurnoMes | null | 'AUSENCIA';

/** Reglas leídas de los parámetros; `null` = sin configurar (no se evalúa). */
export interface ReglasRotacion {
  /** Mínimo de DÍA por día de la semana, de lunes [0] a domingo [6]. */
  minimosDia: number[] | null;
  /** Mínimo de NOCHE (NOCHE + ECU_NOCHE) por día de la semana. */
  minimosNoche: number[] | null;
  maxDiasSinLibre: number | null;
  permiteNocheADia: boolean | null;
}

export interface ConductorDelMes {
  conductorId: number;
  /** D/N/E/L/A, de 2 a 14 letras, o null. */
  patron: string | null;
  /** Días ANTERIORES al mes, en orden (el último es la víspera del día 1). */
  historial: readonly CeldaMes[];
  /** Una celda por día del mes, como está guardada. */
  mes: readonly CeldaMes[];
}

export interface EntradaPropuestaMes {
  /** Días del mes, AAAA-MM-DD, en orden. */
  dias: readonly string[];
  conductores: readonly ConductorDelMes[];
  reglas: ReglasRotacion;
  rehacerTodo: boolean;
}

export interface PropuestaTurno {
  conductorId: number;
  fecha: string;
  turno: TurnoMes;
}

export interface ResultadoPropuestaMes {
  propuestas: PropuestaTurno[];
  resumen: {
    celdasALlenar: number;
    diasBajoMinimo: {
      fecha: string;
      turno: 'DIA' | 'NOCHE';
      hay: number;
      minimo: number;
    }[];
    avisos: { conductorId: number; fecha: string; mensaje: string }[];
    parametrosSinConfigurar: string[];
  };
}

const PERIODO_MINIMO = 2;
const PERIODO_MAXIMO = 14;
const VENTANA_ULTIMOS = 14;

const LETRA: Record<string, TurnoMes> = {
  D: 'DIA',
  N: 'NOCHE',
  E: 'ECU_NOCHE',
  L: 'LIBRE',
  A: 'ADMINISTRATIVO',
};

const NOMBRE: Record<TurnoMes, string> = {
  DIA: 'DÍA',
  NOCHE: 'NOCHE',
  ECU_NOCHE: 'ECU NOCHE',
  LIBRE: 'LIBRE',
  ADMINISTRATIVO: 'ADMINISTRATIVO',
};

const esTurno = (c: CeldaMes | undefined): c is TurnoMes =>
  c !== null && c !== undefined && c !== 'AUSENCIA';

const esTrabajo = (c: CeldaMes | undefined): boolean =>
  esTurno(c) && c !== 'LIBRE';

const esNoche = (c: CeldaMes | undefined): boolean =>
  c === 'NOCHE' || c === 'ECU_NOCHE';

/** «L,M,X,J,V,S,D» → siete enteros; SIN_CONFIGURAR (o cualquier otra forma) → null. */
export function interpretarMinimos(texto: string): number[] | null {
  const limpio = texto.replace(/\s+/g, '');
  if (!/^\d{1,3}(,\d{1,3}){6}$/.test(limpio)) return null;
  return limpio.split(',').map(Number);
}

/** Lunes = 0 … domingo = 6, de una fecha de calendario AAAA-MM-DD (sin huso). */
export function diaDeSemana(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return (new Date(Date.UTC(anio, mes - 1, dia)).getUTCDay() + 6) % 7;
}

const esFinDeSemana = (fecha: string) => diaDeSemana(fecha) >= 5;

// ─────────────────────────── 1 · El ciclo ───────────────────────────

/** Fase (índice % p) → turno, por el historial; null si ningún período encaja con evidencia. */
function cicloDelHistorial(
  conocidos: { indice: number; turno: TurnoMes }[],
): ((indice: number) => TurnoMes | undefined) | null {
  for (let p = PERIODO_MINIMO; p <= PERIODO_MAXIMO; p += 1) {
    if (conocidos.length < 2 * p) continue;
    const fases = new Map<number, TurnoMes>();
    let encaja = true;
    for (const { indice, turno } of conocidos) {
      const previo = fases.get(indice % p);
      if (previo !== undefined && previo !== turno) {
        encaja = false;
        break;
      }
      fases.set(indice % p, turno);
    }
    if (encaja && fases.size === p) return (i) => fases.get(i % p);
  }
  return null;
}

function cicloDelPatron(
  patron: string,
  conocidos: { indice: number; turno: TurnoMes }[],
  inicioMes: number,
): (indice: number) => TurnoMes | undefined {
  const letras = [...patron.toUpperCase()].map((l) => LETRA[l]);
  const largo = letras.length;
  let mejor = (largo - (inicioMes % largo)) % largo; // sin datos: el día 1 es la letra 0
  if (conocidos.length > 0) {
    let mejorAciertos = -1;
    for (let k = 0; k < largo; k += 1) {
      const aciertos = conocidos.filter(
        ({ indice, turno }) => letras[(indice + k) % largo] === turno,
      ).length;
      if (aciertos > mejorAciertos) {
        mejorAciertos = aciertos;
        mejor = k;
      }
    }
  }
  return (i) => letras[(i + mejor) % largo];
}

function cicloDeUltimosDias(
  historial: readonly CeldaMes[],
): ((indice: number) => TurnoMes | undefined) | null {
  if (historial.length < VENTANA_ULTIMOS) return null;
  const inicio = historial.length - VENTANA_ULTIMOS;
  const ventana = historial.slice(inicio);
  if (!ventana.some(esTurno)) return null;
  return (i) => {
    const celda = ventana[(i - inicio) % VENTANA_ULTIMOS];
    return esTurno(celda) ? celda : undefined;
  };
}

// ─────────────────────────── La propuesta ───────────────────────────

interface Estado {
  conductorId: number;
  /** historial + mes, con lo que se va decidiendo. */
  secuencia: CeldaMes[];
  /** Índices (absolutos) del mes que se pueden llenar. */
  llenables: Set<number>;
  ciclo: ((indice: number) => TurnoMes | undefined) | null;
  inicioMes: number;
}

export function proponerMes(
  entrada: EntradaPropuestaMes,
): ResultadoPropuestaMes {
  const { dias, reglas, rehacerTodo } = entrada;
  const avisos: ResultadoPropuestaMes['resumen']['avisos'] = [];
  const diasBajoMinimo: ResultadoPropuestaMes['resumen']['diasBajoMinimo'] = [];

  const estados: Estado[] = [...entrada.conductores]
    .sort((a, b) => a.conductorId - b.conductorId)
    .map((c) => {
      const inicioMes = c.historial.length;
      const secuencia: CeldaMes[] = [...c.historial, ...c.mes];
      const llenables = new Set<number>();
      c.mes.forEach((celda, d) => {
        if (celda === 'AUSENCIA') return;
        if (celda === null || rehacerTodo) llenables.add(inicioMes + d);
      });
      // Lo conocido: el historial y, lo que NO se va a reescribir, del mes.
      const conocidos: { indice: number; turno: TurnoMes }[] = [];
      secuencia.forEach((celda, indice) => {
        if (esTurno(celda) && !llenables.has(indice))
          conocidos.push({ indice, turno: celda });
      });
      const ciclo =
        cicloDelHistorial(conocidos) ??
        (c.patron && /^[DNELA]{2,14}$/i.test(c.patron)
          ? cicloDelPatron(c.patron, conocidos, inicioMes)
          : null) ??
        cicloDeUltimosDias(c.historial);
      // Las celdas que se reescriben arrancan vacías.
      for (const i of llenables) secuencia[i] = null;
      return {
        conductorId: c.conductorId,
        secuencia,
        llenables,
        ciclo,
        inicioMes,
      };
    });

  const celdasALlenar = estados.reduce((s, e) => s + e.llenables.size, 0);

  // Contadores para el reparto (lo guardado que se conserva ya cuenta).
  const noches = new Map<number, number>();
  const diurnos = new Map<number, number>();
  const finesSemana = new Map<number, number>();
  for (const e of estados) {
    noches.set(e.conductorId, 0);
    diurnos.set(e.conductorId, 0);
    finesSemana.set(e.conductorId, 0);
  }
  const contar = (e: Estado, d: number, turno: CeldaMes, signo: 1 | -1) => {
    if (esNoche(turno))
      noches.set(e.conductorId, (noches.get(e.conductorId) ?? 0) + signo);
    if (turno === 'DIA')
      diurnos.set(e.conductorId, (diurnos.get(e.conductorId) ?? 0) + signo);
    if (esTrabajo(turno) && esFinDeSemana(dias[d]))
      finesSemana.set(
        e.conductorId,
        (finesSemana.get(e.conductorId) ?? 0) + signo,
      );
  };
  for (const e of estados)
    dias.forEach((_, d) => {
      const i = e.inicioMes + d;
      if (!e.llenables.has(i)) contar(e, d, e.secuencia[i], 1);
    });

  /** ¿Se admite `turno` en el índice i, por las reglas de descanso? Motivo si no. */
  const motivoDescanso = (
    e: Estado,
    i: number,
    turno: TurnoMes,
  ): string | null => {
    if (reglas.permiteNocheADia === false) {
      if (turno === 'DIA' && esNoche(e.secuencia[i - 1]))
        return 'viene de una noche y no se admite DÍA tras NOCHE';
      const siguiente = e.secuencia[i + 1];
      if (esNoche(turno) && siguiente === 'DIA' && !e.llenables.has(i + 1))
        return 'al día siguiente tiene DÍA y no se admite DÍA tras NOCHE';
    }
    if (reglas.maxDiasSinLibre !== null && esTrabajo(turno)) {
      let racha = 1;
      for (let j = i - 1; j >= 0 && esTrabajo(e.secuencia[j]); j -= 1)
        racha += 1;
      if (racha > reglas.maxDiasSinLibre)
        return `llevaría ${racha} días seguidos sin LIBRE (máximo ${reglas.maxDiasSinLibre})`;
    }
    return null;
  };

  const fijar = (e: Estado, d: number, turno: TurnoMes) => {
    const i = e.inicioMes + d;
    const previo = e.secuencia[i];
    if (esTurno(previo)) contar(e, d, previo, -1);
    e.secuencia[i] = turno;
    contar(e, d, turno, 1);
  };

  dias.forEach((fecha, d) => {
    // 1 + 3 · El ciclo, ajustado por el descanso.
    for (const e of estados) {
      const i = e.inicioMes + d;
      if (!e.llenables.has(i) || !e.ciclo) continue;
      const pedido = e.ciclo(i);
      if (!pedido) continue;
      const motivo = motivoDescanso(e, i, pedido);
      if (motivo) {
        fijar(e, d, 'LIBRE');
        avisos.push({
          conductorId: e.conductorId,
          fecha,
          mensaje: `Su ciclo pedía ${NOMBRE[pedido]}, pero ${motivo}: se propone LIBRE.`,
        });
      } else {
        fijar(e, d, pedido);
      }
    }

    // 4 · Mínimos del día.
    const semana = diaDeSemana(fecha);
    const cubrir = (
      tipo: 'DIA' | 'NOCHE',
      minimo: number,
      cuenta: (c: CeldaMes) => boolean,
      contador: Map<number, number>,
    ) => {
      let hay = estados.filter((e) =>
        cuenta(e.secuencia[e.inicioMes + d]),
      ).length;
      if (hay >= minimo) return;
      const candidatos = estados
        .filter((e) => {
          const i = e.inicioMes + d;
          const actual = e.secuencia[i];
          return (
            e.llenables.has(i) &&
            (actual === null || actual === 'LIBRE') &&
            motivoDescanso(e, i, tipo) === null
          );
        })
        .sort((a, b) => {
          const ca = a.secuencia[a.inicioMes + d] === null ? 0 : 1;
          const cb = b.secuencia[b.inicioMes + d] === null ? 0 : 1;
          return (
            ca - cb ||
            (contador.get(a.conductorId) ?? 0) -
              (contador.get(b.conductorId) ?? 0) ||
            (esFinDeSemana(fecha)
              ? (finesSemana.get(a.conductorId) ?? 0) -
                (finesSemana.get(b.conductorId) ?? 0)
              : 0) ||
            a.conductorId - b.conductorId
          );
        });
      for (const e of candidatos) {
        if (hay >= minimo) break;
        fijar(e, d, tipo);
        hay += 1;
      }
      if (hay < minimo)
        diasBajoMinimo.push({ fecha, turno: tipo, hay, minimo });
    };
    if (reglas.minimosDia)
      cubrir('DIA', reglas.minimosDia[semana], (c) => c === 'DIA', diurnos);
    if (reglas.minimosNoche)
      cubrir('NOCHE', reglas.minimosNoche[semana], esNoche, noches);
  });

  // 5 · Reparto de noches y fines de semana.
  const participan = estados.filter((e) =>
    dias.some((_, d) => esTrabajo(e.secuencia[e.inicioMes + d])),
  );
  const avisarReparto = (
    contador: Map<number, number>,
    que: string,
    marca: (c: CeldaMes, fecha: string) => boolean,
  ) => {
    if (participan.length < 2) return;
    const valores = participan.map((e) => contador.get(e.conductorId) ?? 0);
    const maximo = Math.max(...valores);
    const minimo = Math.min(...valores);
    if (maximo - minimo <= 1) return;
    for (const e of participan) {
      if ((contador.get(e.conductorId) ?? 0) !== maximo) continue;
      const ultimo = [...dias.keys()]
        .reverse()
        .find((d) => marca(e.secuencia[e.inicioMes + d], dias[d]));
      avisos.push({
        conductorId: e.conductorId,
        fecha: dias[ultimo ?? dias.length - 1],
        mensaje: `Lleva ${maximo} ${que} en el mes y hay quien lleva ${minimo}: el reparto difiere en más de uno.`,
      });
    }
  };
  avisarReparto(noches, 'noches', (c) => esNoche(c));
  avisarReparto(
    finesSemana,
    'días de fin de semana trabajados',
    (c, fecha) => esTrabajo(c) && esFinDeSemana(fecha),
  );

  // Solo lo que cambia respecto de lo guardado.
  const propuestas: PropuestaTurno[] = [];
  const original = new Map(
    entrada.conductores.map((c) => [c.conductorId, c.mes]),
  );
  for (const e of estados) {
    const guardado = original.get(e.conductorId) ?? [];
    dias.forEach((fecha, d) => {
      const i = e.inicioMes + d;
      const turno = e.secuencia[i];
      if (e.llenables.has(i) && esTurno(turno) && turno !== guardado[d])
        propuestas.push({ conductorId: e.conductorId, fecha, turno });
    });
  }
  propuestas.sort(
    (a, b) => a.fecha.localeCompare(b.fecha) || a.conductorId - b.conductorId,
  );

  const parametrosSinConfigurar = [
    reglas.minimosDia ? null : 'DAF_MIN_CONDUCTORES_DIA',
    reglas.minimosNoche ? null : 'DAF_MIN_CONDUCTORES_NOCHE',
    reglas.maxDiasSinLibre !== null ? null : 'DAF_MAX_DIAS_SIN_LIBRE',
    reglas.permiteNocheADia !== null ? null : 'DAF_PERMITE_NOCHE_A_DIA',
  ].filter((c): c is string => c !== null);

  return {
    propuestas,
    resumen: { celdasALlenar, diasBajoMinimo, avisos, parametrosSinConfigurar },
  };
}
