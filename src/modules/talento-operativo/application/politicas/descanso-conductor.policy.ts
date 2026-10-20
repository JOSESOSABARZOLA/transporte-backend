/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: descanso-conductor.policy.ts
 * Responsabilidad: Decidir las restricciones de descanso de un conductor al tomar un bloque de tramos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * POL-02. Las reglas de descanso están en `talento-operativo` y en ningún otro sitio, tanto si
 * protegen a un inspector como si protegen a quien conduce.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESDE EL 2026-10-14 EL CONDUCTOR SE ASIGNA SOLO POR TRAMOS (una sola fuente de ocupación,
 * `t_tramo_transporte`). La asignación clásica 1 operativo → 1 conductor desapareció: el
 * `PATCH /transporte/operativos/:id` delega en la asignación por tramos y el adicional ya no
 * hereda conductor. Con ello, cuatro de las seis reglas de este archivo quedaron sin llamador
 * y se retiraron, porque la política de tramos (`transporte/.../asignacion-conductor.policy.ts`)
 * ya las aplica SOBRE CADA TRAMO y con traslados, cosa que aquí no era posible:
 *
 *   · ausencia (RN-30)            → `CONDUCTOR_AUSENTE`
 *   · nombramiento (RN-26, RN-33) → `NOMBRAMIENTO_FUERA_DE_HORARIO`
 *   · solapamiento (VAL-21)       → `SOLAPAMIENTO`
 *   · jornada (VAL-22)            → `JORNADA_MAXIMA`, medida como lapso del primer al último
 *                                    tramo (decisión D8 del 2026-10-14)
 *
 * SE QUEDAN AQUÍ LAS DOS QUE LA POLÍTICA DE TRAMOS NO TENÍA, y que necesitan el historial de
 * otros días: RN-44 (quien condujo en patrulla no repite) y RN-25 (tope de salidas nocturnas o
 * de fin de semana). Se exponen POR LOTE a través de `ElegibilidadService.evaluadorDeConduccion`,
 * que devuelve solo veredictos: los antecedentes no cruzan la frontera del submódulo.
 *
 * LOS OPERATIVOS DEL BLOQUE NO CUENTAN CONTRA SÍ MISMOS. Un operativo «dejar y retirar» tiene
 * dos tramos que se asignan por separado: al asignar el «retirar», el «dejar» del MISMO
 * operativo ya está en el historial, y sin excluirlo RN-44 diría que el conductor «condujo en
 * patrulla ese mismo día».
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { CODIGOS_ERROR } from '../../../../common/errors/codigos-error';
import type { VeredictoElegibilidad } from './descanso-personal.policy';

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

/** Lo que se sabe del conductor para decidir. Lo reúne `ElegibilidadService` por lote. */
export interface AntecedentesConduccion {
  nombre: string;
  /** Patrullas que condujo (un tramo suyo en un formulario de patrulla). RN-44. */
  patrullas: { fecha: Date; operativoId: number }[];
  /** Operativos pesados (nocturnos o de fin de semana) que condujo en el período. RN-25. */
  salidasPesadas: { operativoId: number }[];
}

/** El bloque que se pretende asignar. */
export interface ContextoConduccion {
  fecha: Date;
  /** Algún operativo del bloque es de un formulario de patrulla. */
  esPatrulla: boolean;
  /** Algún operativo del bloque es nocturno, o la fecha cae en fin de semana. */
  esPesada: boolean;
  /** Los operativos del bloque: sus propios tramos no cuentan como antecedente. */
  operativoIds: readonly number[];
  diasDescansoPatrulla: number;
  topeSalidasPesadas: number;
}

/**
 * Los motivos que impiden al conductor tomar el bloque. Lista vacía = puede. Se devuelven TODOS
 * (no solo el primero) porque la pantalla de candidatos los muestra juntos.
 */
export function verificarRestriccionesDeConduccion(
  conductor: AntecedentesConduccion,
  contexto: ContextoConduccion,
): VeredictoElegibilidad[] {
  return [
    reglaPatrullaConsecutiva(conductor, contexto),
    reglaTopeSalidasPesadas(conductor, contexto),
  ].filter((veredicto): veredicto is VeredictoElegibilidad =>
    Boolean(veredicto),
  );
}

/**
 * RN-44. El conductor que condujo en patrulla ese mismo día o dentro de `DIAS_DESCANSO_PATRULLA`
 * días antes no repite. Solo cuenta si el bloque ES de patrulla.
 */
function reglaPatrullaConsecutiva(
  conductor: AntecedentesConduccion,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (!contexto.esPatrulla) return undefined;

  const propios = new Set(contexto.operativoIds);
  const dias = conductor.patrullas
    .filter((patrulla) => !propios.has(patrulla.operativoId))
    .map((patrulla) => diferenciaEnDias(patrulla.fecha, contexto.fecha))
    .filter((d) => d >= 0 && d <= contexto.diasDescansoPatrulla);
  if (dias.length === 0) return undefined;

  const masReciente = Math.min(...dias);
  return sinElegir(
    CODIGOS_ERROR.CONDUCTOR_PATRULLA_CONSECUTIVA,
    `${conductor.nombre} condujo en patrulla ${masReciente === 0 ? 'ese mismo día' : masReciente === 1 ? 'el día anterior' : `hace ${masReciente} días`} y no puede repetir.`,
  );
}

/**
 * RN-25. El conductor no supera su tope de salidas nocturnas o de fin de semana.
 *
 * Solo cuenta si ESTE bloque es pesado: sumar un martes diurno al tope no tendría sentido, y la
 * regla existe para repartir las guardias. El umbral es `TOPE_SALIDAS_PESADAS` y el período
 * `PERIODO_COMPUTO_SALIDAS`, los mismos del personal.
 */
function reglaTopeSalidasPesadas(
  conductor: AntecedentesConduccion,
  contexto: ContextoConduccion,
): VeredictoElegibilidad | undefined {
  if (!contexto.esPesada) return undefined;

  const propios = new Set(contexto.operativoIds);
  const acumuladas = new Set(
    conductor.salidasPesadas
      .map((salida) => salida.operativoId)
      .filter((id) => !propios.has(id)),
  ).size;
  if (acumuladas < contexto.topeSalidasPesadas) return undefined;

  return sinElegir(
    CODIGOS_ERROR.TOPE_SALIDAS_PESADAS,
    `${conductor.nombre} alcanzó el tope de ${contexto.topeSalidasPesadas} salidas nocturnas o de fin de semana en el período. Considere repartir la carga con otro conductor.`,
  );
}

function sinElegir(
  codigo: VeredictoElegibilidad['codigo'],
  motivo: string,
): VeredictoElegibilidad {
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
