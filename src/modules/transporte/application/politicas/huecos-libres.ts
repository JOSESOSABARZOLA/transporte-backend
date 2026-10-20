/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · horas libres
 * Archivo: huecos-libres.ts
 * Responsabilidad: Calcular los huecos libres de un conductor o de un vehículo en la jornada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LAS HORAS LIBRES SON UNA RESTA DE INTERVALOS: la ventana en la que el recurso puede trabajar
 * menos sus tramos ocupados (`t_tramo_transporte`, la única fuente de ocupación). Un «dejar y
 * retirar» deja libre el intervalo medio, y eso es justamente lo que se quiere aprovechar.
 *
 *   1. Los tramos ocupados se ordenan y se fusionan los que se pisan.
 *   2. Huecos = ventana − tramos, en minutos de la línea 05H00 → 05H00 (ver `linea-de-tiempo.ts`).
 *   3. Jornada máxima (decisión D8, lapso del primer al último tramo): un hueco nunca lleva la
 *      jornada más allá de `primerInicio + máximo` ni empieza antes de `últimoFin − máximo`.
 *   4. De cada hueco se dan tres medidas:
 *        · BRUTO        — el hueco tal cual;
 *        · ÚTIL MÍNIMO  — descuenta el traslado mínimo (TRASLADO_MISMA_ZONA_MIN) por cada lado en el
 *                          que el conductor viene de otro tramo o tiene que llegar a otro: es el
 *                          mejor caso, lo que se pinta si no se pregunta por un destino;
 *        · APROVECHABLE — solo si se pide para una zonal concreta: descuenta el traslado real
 *                          (anterior → destino) y (destino → siguiente) con la matriz y sus
 *                          valores por defecto (`traslados.ts`).
 *   5. Se descartan los huecos cuyo útil mínimo no llega a DAF_HUECO_MINIMO_MIN.
 *   6. Decisión D9: se parten por la ventana del TURNO. Lo que cae fuera del turno se marca
 *      «horas extra» (se puede asignar, con aviso); sin turno con horario, todo es horas extra.
 *
 * LOS HUECOS NO SE GUARDAN: cambian con cada asignación y una copia quedaría desactualizada.
 *
 * ES PURA: sin base de datos ni reloj.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import type { TramoEvaluado } from './asignacion-conductor.policy';
import type { Franja } from './linea-de-tiempo';
import {
  minutosTraslado,
  type Lugar,
  type ParametrosTraslado,
  type TablaTraslados,
} from './traslados';

export interface EntradaHuecos {
  /** Dónde PUEDE trabajar (límite duro). `null` = no puede ese día: no hay huecos. */
  ventana: Franja | null;
  /** La ventana de su turno (límite blando, D9). `null` = sin turno con horario: todo es extra. */
  ventanaTurno: Franja | null;
  ocupados: readonly TramoEvaluado[];
  /** Dónde arranca el día si aún no tiene tramos antes del hueco (dónde amanece su vehículo). */
  amaneceEn: Lugar | null;
  traslado: ParametrosTraslado;
  tablaTraslados: TablaTraslados;
  /** DAF_HUECO_MINIMO_MIN. */
  minimoMin: number;
  /** DAF_MAX_JORNADA_HORAS en minutos; `null` = sin tope (un vehículo). */
  maxJornadaMin: number | null;
  /** Zonal del servicio que se quiere intercalar, para el aprovechable. */
  destino?: Lugar | null;
}

export interface HuecoLibre {
  franja: Franja;
  brutoMin: number;
  utilMinimoMin: number;
  /** Solo si se pidió un destino; `null` si no. */
  aprovechableMin: number | null;
  /** De dónde viene el recurso al empezar el hueco (su tramo anterior, o donde amanece). */
  desde: Lugar | null;
  /** Adónde tiene que llegar al terminarlo (su tramo siguiente). */
  hacia: Lugar | null;
  /** Fuera de la ventana de su turno (D9): se puede asignar, son horas extra. */
  horasExtra: boolean;
}

/** Los huecos libres de un recurso en la jornada. Ver el algoritmo en la cabecera. */
export function huecosLibres(entrada: EntradaHuecos): HuecoLibre[] {
  const { ventana } = entrada;
  if (!ventana || ventana.fin <= ventana.inicio) return [];

  const ocupados = [...entrada.ocupados].sort(
    (a, b) => a.franja.inicio - b.franja.inicio,
  );
  const bloques = fusionar(ocupados);

  // 2 · Ventana − tramos.
  const huecos: { franja: Franja; desde: Lugar | null; hacia: Lugar | null }[] =
    [];
  let cursor = ventana.inicio;
  let desde: Lugar | null = entrada.amaneceEn;
  for (const bloque of bloques) {
    if (bloque.franja.inicio > cursor) {
      huecos.push({
        franja: {
          inicio: cursor,
          fin: Math.min(bloque.franja.inicio, ventana.fin),
        },
        desde,
        hacia: bloque.origen,
      });
    }
    cursor = Math.max(cursor, bloque.franja.fin);
    desde = bloque.destino;
    if (cursor >= ventana.fin) break;
  }
  if (cursor < ventana.fin) {
    huecos.push({
      franja: { inicio: cursor, fin: ventana.fin },
      desde,
      hacia: null,
    });
  }

  // 3 · D8: el lapso de la jornada no pasa del máximo. Los huecos INTERIORES (entre su primer y su
  // último tramo) no la alargan; solo se recortan el de antes del primero y el de después del último.
  if (entrada.maxJornadaMin !== null && bloques.length > 0) {
    const primerInicio = bloques[0].franja.inicio;
    const ultimoFin = bloques[bloques.length - 1].franja.fin;
    for (const hueco of huecos) {
      if (hueco.franja.fin <= primerInicio)
        hueco.franja.inicio = Math.max(
          hueco.franja.inicio,
          ultimoFin - entrada.maxJornadaMin,
        );
      if (hueco.franja.inicio >= ultimoFin)
        hueco.franja.fin = Math.min(
          hueco.franja.fin,
          primerInicio + entrada.maxJornadaMin,
        );
    }
  }

  // 6 · D9: se parte por la ventana del turno.
  const partes = huecos
    .filter((h) => h.franja.fin > h.franja.inicio)
    .flatMap((h) =>
      partirPorTurno(h.franja, entrada.ventanaTurno).map((p) => ({
        ...p,
        // El traslado de entrada solo cuenta en la parte que empieza donde empieza el hueco, y el
        // de salida en la que termina donde termina.
        desde: p.franja.inicio === h.franja.inicio ? h.desde : null,
        hacia: p.franja.fin === h.franja.fin ? h.hacia : null,
      })),
    );

  // 4 y 5 · Medidas y mínimo útil.
  return partes
    .map(({ franja, horasExtra, desde: de, hacia: a }) => {
      const brutoMin = franja.fin - franja.inicio;
      const minimo = entrada.traslado.mismaZona;
      const utilMinimoMin = brutoMin - (de ? minimo : 0) - (a ? minimo : 0);
      const aprovechableMin = entrada.destino
        ? brutoMin -
          minutosTraslado(
            de,
            entrada.destino,
            entrada.tablaTraslados,
            entrada.traslado,
          ) -
          minutosTraslado(
            entrada.destino,
            a,
            entrada.tablaTraslados,
            entrada.traslado,
          )
        : null;
      return {
        franja,
        brutoMin,
        utilMinimoMin,
        aprovechableMin,
        desde: de,
        hacia: a,
        horasExtra,
      };
    })
    .filter((hueco) => hueco.utilMinimoMin >= entrada.minimoMin);
}

/** Tramos que se pisan, fusionados: del primero se toma el origen y del último el destino. */
function fusionar(
  ordenados: readonly TramoEvaluado[],
): { franja: Franja; origen: Lugar | null; destino: Lugar | null }[] {
  const fusion: {
    franja: Franja;
    origen: Lugar | null;
    destino: Lugar | null;
  }[] = [];
  for (const tramo of ordenados) {
    const ultimo = fusion[fusion.length - 1];
    if (ultimo && tramo.franja.inicio < ultimo.franja.fin) {
      if (tramo.franja.fin > ultimo.franja.fin) {
        ultimo.franja = { ...ultimo.franja, fin: tramo.franja.fin };
        ultimo.destino = tramo.destino ?? tramo.origen;
      }
      continue;
    }
    fusion.push({
      franja: { ...tramo.franja },
      origen: tramo.origen,
      destino: tramo.destino ?? tramo.origen,
    });
  }
  return fusion;
}

/** Parte una franja en lo que cae dentro del turno y lo que cae fuera (horas extra). */
function partirPorTurno(
  franja: Franja,
  turno: Franja | null,
): { franja: Franja; horasExtra: boolean }[] {
  if (!turno) return [{ franja, horasExtra: true }];
  const dentro = {
    inicio: Math.max(franja.inicio, turno.inicio),
    fin: Math.min(franja.fin, turno.fin),
  };
  if (dentro.fin <= dentro.inicio) return [{ franja, horasExtra: true }];
  const partes: { franja: Franja; horasExtra: boolean }[] = [];
  if (franja.inicio < dentro.inicio)
    partes.push({
      franja: { inicio: franja.inicio, fin: dentro.inicio },
      horasExtra: true,
    });
  partes.push({ franja: dentro, horasExtra: false });
  if (dentro.fin < franja.fin)
    partes.push({
      franja: { inicio: dentro.fin, fin: franja.fin },
      horasExtra: true,
    });
  return partes;
}
