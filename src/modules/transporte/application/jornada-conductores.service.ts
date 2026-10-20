/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada de los conductores
 * Archivo: jornada-conductores.service.ts
 * Responsabilidad: Componer la jornada de cada conductor del día, con sus huecos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-31
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL HALLAZGO CENTRAL DEL LEVANTAMIENTO, CONVERTIDO EN DATO.
 *
 * El sistema modelaba la asignación como un ATRIBUTO DEL OPERATIVO: «¿quién lleva este
 * operativo?». La DAF resuelve otra cosa: «¿cómo encajo doce operativos simultáneos en
 * treinta y cuatro conductores?». La analista lo dijo con estas palabras: *«ahorita está
 * de uno a uno… pero en la realidad así no funciona, porque hay varios operativos por
 * cubrir»*.
 *
 * El Excel lo confirma sobre el mes completo: de 422 celdas de actividad con horario, 263
 * llevan un rango, **106 llevan dos y 53 llevan tres o más**; el máximo son cinco. El
 * 38 % de las asignaciones reales encadenan más de un operativo en el mismo turno.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO ASIGNA NADA, Y ESO ES DELIBERADO. Este servicio COMPONE UNA VISTA: dice qué tiene
 * cada conductor (sus TRAMOS, desde el 2026-10-14). La asignación es un acto explícito en
 * «Planificar el día», con todas sus reglas.
 *
 * El análisis lo recomienda expresamente: la evidencia muestra un problema de optimización
 * con restricciones blandas que la planificadora resuelve NEGOCIANDO —activar libres, pedir
 * priorización, acordar vehículo compartido—. **El sistema propone y avisa; no decide.**
 *
 * LOS HUECOS APROVECHABLES, con su traslado, los calcula `GET /transporte/huecos/:fecha`
 * (`politicas/huecos-libres.ts`, 2026-10-14).
 */

import { Injectable } from '@nestjs/common';
import type { SectorCiudad, TipoContrato } from '@prisma/client';

import { FlotaRepository } from '../infrastructure/flota.repository';
import { nombreDeUnidad } from './politicas/nombre-unidad';

/** Un operativo dentro de la jornada de un conductor. */
export interface TramoDeJornada {
  identificador: string;
  horario: string;
  horaInicio: string;
  horaFin: string;
  esNocturno: boolean;
  placa: string | null;
  punto: string;
  /** Unidad que cargó el operativo, en palabras (2026-10-07). */
  departamento: string | null;
  departamentoCodigo: string | null;
}

/** La jornada de un conductor ese día. */
export interface JornadaDeConductor {
  conductorId: number;
  nombreCompleto: string;
  sector: SectorCiudad | null;
  parqueaderoAutorizado: boolean;
  tipoContrato: TipoContrato | null;
  /** Vacío si está disponible y todavía no lleva nada. */
  tramos: TramoDeJornada[];
  /** Suma de las horas de sus tramos. Se muestra, no bloquea. */
  horasAcumuladas: number;
  /** RN-45: los ausentes llegan marcados, no excluidos. Ver abajo. */
  disponible: boolean;
}

@Injectable()
export class JornadaConductoresService {
  constructor(private readonly flota: FlotaRepository) {}

  /**
   * La jornada de todos los conductores del día.
   *
   * LOS AUSENTES SE MUESTRAN MARCADOS, no se excluyen, y es lo contrario de lo que hace
   * `conductoresDisponibles`. Aquél arma un desplegable —ofrecer a alguien de vacaciones
   * sería ofrecer lo que después se rechaza—; éste es un TABLERO, y a la DAF le importa
   * ver que cinco de sus treinta y cuatro conductores están de vacaciones esa semana:
   * es justamente lo que explica por qué no le alcanza la flota.
   */
  async componer(fecha: Date): Promise<JornadaDeConductor[]> {
    const [conductores, ausentes, conducciones] = await Promise.all([
      this.flota.listarConductores(),
      this.flota.conductoresAusentes(fecha),
      this.flota.conduccionesDeLaJornada(fecha),
    ]);

    // Agrupar en memoria: la consulta trae la jornada entera de una vez, y repartirla por
    // conductor aquí evita una consulta por cada uno de los treinta y cuatro.
    const porConductor = new Map<number, TramoDeJornada[]>();

    for (const conduccion of conducciones) {
      const tramos = porConductor.get(conduccion.conductorId) ?? [];

      tramos.push({
        identificador: conduccion.identificador,
        horario: `${conduccion.horaInicio.replace(':', 'H')} A ${conduccion.horaFin.replace(':', 'H')}`,
        horaInicio: conduccion.horaInicio,
        horaFin: conduccion.horaFin,
        esNocturno: conduccion.esNocturno,
        placa: conduccion.placa,
        punto: conduccion.punto,
        departamento: nombreDeUnidad(conduccion.creadoPorRol),
        departamentoCodigo: conduccion.creadoPorRol ?? null,
      });

      porConductor.set(conduccion.conductorId, tramos);
    }

    return conductores.map((conductor) => {
      const tramos = porConductor.get(conductor.id) ?? [];

      return {
        conductorId: conductor.id,
        nombreCompleto: conductor.nombreCompleto,
        sector: conductor.sector,
        parqueaderoAutorizado: conductor.parqueaderoAutorizado,
        tipoContrato: conductor.tipoContrato,
        tramos,
        horasAcumuladas: sumarHoras(conducciones, conductor.id),
        disponible: !ausentes.has(conductor.id),
      };
    });
  }
}

/**
 * Horas al volante acumuladas ese día.
 *
 * Se suman las de sus TRAMOS (2026-10-14), que el repositorio mide con `duracionEnHoras` de
 * `rango-horario.ts`: el cruce de medianoche se resuelve allí, «el archivo de mayor riesgo del
 * sistema» (FASE3 §OV-02), y no con una segunda aritmética aquí.
 */
function sumarHoras(
  conducciones: { conductorId: number; horas: number }[],
  conductorId: number,
): number {
  return conducciones
    .filter((conduccion) => conduccion.conductorId === conductorId)
    .reduce((suma, conduccion) => suma + conduccion.horas, 0);
}
