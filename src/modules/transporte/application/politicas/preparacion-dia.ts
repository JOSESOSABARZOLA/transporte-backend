/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte · planificar el día
 * Archivo: preparacion-dia.ts
 * Responsabilidad: Decidir qué falta antes de asignar el transporte de un día («Antes de asignar»).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * QUE LA ANALISTA SEPA QUÉ FALTA Y QUÉ HACER (mejoras de usabilidad DAF, 2026-10-06).
 *
 *   · CUADRO LISTO = el cuadro de la fecha existe y tiene al menos un operativo ACTIVO, en
 *     cualquier estado (abierto, cerrado…): lo que necesita la DAF es que haya qué cubrir; el
 *     estado se informa aparte para el mensaje.
 *   · TURNOS CARGADOS = hay al menos un turno de conductor registrado para ESA fecha.
 *   · CONDUCTOR INCOMPLETO = le falta el SECTOR o el CONTRATO, o tiene «parqueadero autorizado»
 *     marcado SIN un acta vigente ese día (número + desde ≤ fecha ≤ hasta). No tener parqueadero
 *     no es un faltante: es lo normal.
 *
 * La ventana de asignación NO se calcula aquí: la entrega `/ventanas/mi-estado`, que ya usa la UI.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { actaVigente, type ConductorConActa } from './acta-parqueadero';
import { estaPublicado } from './publicacion-turnos';

export type FaltanteConductor = 'sector' | 'contrato' | 'parqueadero';

export interface ConductorParaPreparar extends ConductorConActa {
  id: number;
  nombreCompleto: string;
  sector: string | null;
  tipoContrato: string | null;
}

export interface Preparacion {
  fecha: string;
  cuadro: {
    existe: boolean;
    estado: string | null;
    operativos: number;
    listo: boolean;
  };
  turnos: {
    cargados: boolean;
    conductoresActivos: number;
    conductoresConTurno: number;
    /** Estado del mes de la fecha (2026-10-07). Sin fila, BORRADOR. */
    estadoMes: string;
    /** Si el mes está publicado: solo entonces los turnos cuentan para asignar. */
    publicados: boolean;
  };
  conductoresIncompletos: {
    id: number;
    nombre: string;
    faltan: FaltanteConductor[];
  }[];
}

/** Lo que le falta a la ficha de un conductor para planificar con él. */
export function faltantesDeConductor(
  conductor: ConductorParaPreparar,
  fecha: Date,
): FaltanteConductor[] {
  const faltan: FaltanteConductor[] = [];
  if (!conductor.sector) faltan.push('sector');
  if (!conductor.tipoContrato) faltan.push('contrato');
  if (conductor.parqueaderoAutorizado && !actaVigente(conductor, fecha)) {
    faltan.push('parqueadero');
  }
  return faltan;
}

/** Arma la lista «Antes de asignar». Pura. */
export function prepararDia(entrada: {
  fecha: Date;
  cuadro: { estado: string; operativos: number } | null;
  conductores: readonly ConductorParaPreparar[];
  /** Conductores con algún turno registrado ESA fecha. */
  conductoresConTurno: ReadonlySet<number>;
  /** Estado del mes de la fecha; sin indicar, BORRADOR. */
  estadoMes?: string;
}): Preparacion {
  const { fecha, cuadro, conductores, conductoresConTurno } = entrada;
  const estadoMes = entrada.estadoMes ?? 'BORRADOR';
  const activos = new Set(conductores.map((c) => c.id));
  const conTurno = [...conductoresConTurno].filter((id) => activos.has(id));

  return {
    fecha: fecha.toISOString().slice(0, 10),
    cuadro: {
      existe: cuadro !== null,
      estado: cuadro?.estado ?? null,
      operativos: cuadro?.operativos ?? 0,
      listo: cuadro !== null && cuadro.operativos > 0,
    },
    turnos: {
      cargados: conductoresConTurno.size > 0,
      conductoresActivos: conductores.length,
      conductoresConTurno: conTurno.length,
      estadoMes,
      publicados: estaPublicado(estadoMes),
    },
    conductoresIncompletos: conductores
      .map((c) => ({
        id: c.id,
        nombre: c.nombreCompleto,
        faltan: faltantesDeConductor(c, fecha),
      }))
      .filter((c) => c.faltan.length > 0),
  };
}
