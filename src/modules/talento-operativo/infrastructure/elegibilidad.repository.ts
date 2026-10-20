/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: elegibilidad.repository.ts
 * Responsabilidad: Reunir los antecedentes que las políticas necesitan.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * TODAS LAS CONSULTAS SON POR LOTE. La pantalla de registro pide los elegibles de un
 * formulario y puede haber cincuenta candidatos; preguntar por cada uno sería un `N+1`
 * de ciento cincuenta viajes a la base cada vez que alguien abre el desplegable.
 * Aquí se traen los antecedentes de todo el grupo en tres consultas y se decide en
 * memoria.
 *
 * LEE `t_operativo`, `t_asignacion_personal` Y, PARA QUIEN CONDUCE, `t_tramo_transporte` (su única
 * fuente de ocupación desde el 2026-10-14), con la misma licencia que
 * `HistorialJornadaRepository` y por el mismo motivo: las reglas de descanso necesitan
 * saber qué tiene ya asignado la persona ESE día, y el día en construcción todavía no
 * está consolidado en el historial. No importa el repositorio de otro submódulo ni
 * escribe fuera de su contexto.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoDisponibilidad,
  EstadoTurno,
  type Funcionario,
} from '@prisma/client';

import {
  duracionEnHoras,
  RangoHorario,
} from '../../operativos/domain/rango-horario';
import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Operativo del día al que una persona ya está asignada. */
export interface AsignacionDelDia {
  funcionarioId: number;
  operativoId: number;
  identificador: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
}

/** Un operativo que el conductor condujo (al menos un tramo suyo). RN-25. */
export interface SalidaDeConductor {
  conductorId: number;
  operativoId: number;
  fecha: Date;
  esNocturno: boolean;
}

/** Ausencia que cubre una fecha concreta. */
export interface AusenciaEnFecha {
  estado: EstadoDisponibilidad;
  hasta: Date;
}

@Injectable()
export class ElegibilidadRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────── Personal ───────────────────────

  async buscarFuncionarios(ids: number[]): Promise<Funcionario[]> {
    if (ids.length === 0) return [];
    return this.prisma.funcionario.findMany({ where: { id: { in: ids } } });
  }

  /**
   * Ausencias que cubren la fecha, por persona.
   *
   * Devuelve el estado y la fecha de retorno —lo que VAL-12 pide mostrar— y **no
   * `disp_motivo`**, que es texto libre y puede describir una condición de salud.
   */
  async ausenciasEnFecha(
    funcionarioIds: number[],
    fecha: Date,
  ): Promise<Map<number, AusenciaEnFecha>> {
    if (funcionarioIds.length === 0) return new Map();

    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        estado: {
          in: [
            EstadoDisponibilidad.VACACIONES,
            EstadoDisponibilidad.REPOSO_MEDICO,
            EstadoDisponibilidad.CALAMIDAD,
            EstadoDisponibilidad.PERMISO,
            // Las tres del 2026-10-08. Misma lista que `ESTADOS_QUE_EXCLUYEN` (reglas-personal):
            // si se agrega una allí y no aquí, VAL-12 no mostraría su fecha de retorno.
            EstadoDisponibilidad.LICENCIA,
            EstadoDisponibilidad.CAPACITACION,
            EstadoDisponibilidad.COMISION_SERVICIOS,
          ],
        },
        desde: { lte: fecha },
        hasta: { gte: fecha },
      },
      select: { funcionarioId: true, estado: true, hasta: true },
      orderBy: { hasta: 'desc' },
    });

    const porPersona = new Map<number, AusenciaEnFecha>();
    for (const fila of filas) {
      if (fila.funcionarioId === null) continue;
      // La primera que llega es la de retorno más lejano: es la que hay que informar.
      if (!porPersona.has(fila.funcionarioId)) {
        porPersona.set(fila.funcionarioId, {
          estado: fila.estado,
          hasta: fila.hasta,
        });
      }
    }
    return porPersona;
  }

  /**
   * El turno de la cobertura de Instrucción (DIURNO/NOCTURNO/DESCANSO) de cada persona en
   * esa fecha, si lo tiene.
   *
   * Solo el personal de Instrucción tiene filas en `t_cobertura_turno`; para el resto el
   * mapa sale vacío y ni el descanso ni la ventana de turno les afecta. Una celda vacía
   * (persona sin turno ese día) simplemente no aparece en el mapa.
   */
  async turnosEnFecha(
    funcionarioIds: number[],
    fecha: Date,
  ): Promise<Map<number, EstadoTurno>> {
    if (funcionarioIds.length === 0) return new Map();

    // `cob_fecha` es `@db.Date` (medianoche UTC); se normaliza la fecha al día para
    // igualar sin arrastrar la hora del contexto del operativo.
    const dia = new Date(
      Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()),
    );

    const filas = await this.prisma.coberturaTurno.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        fecha: dia,
      },
      select: { funcionarioId: true, estado: true },
    });

    return new Map(filas.map((fila) => [fila.funcionarioId, fila.estado]));
  }

  /**
   * Operativos del día a los que las personas ya están asignadas.
   *
   * `excluirOperativoId` sirve al editar: un operativo no se solapa consigo mismo, y
   * sin excluirlo cualquier modificación de horario se rechazaría a sí misma.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * `activo: true` ES IMPRESCINDIBLE, Y FALTÓ HASTA EL 2026-08-07.
   *
   * La baja del operativo es LÓGICA (PV-10): `t_asignacion_personal` **no se borra** y no
   * tiene columna propia de estado, así que la única señal de que la asignación ya no
   * cuenta es `oper_activo`. Sin este filtro, un operativo retirado seguía ocupando a su
   * personal: RN-28 rechazaba a la persona por solaparse con un operativo que ya no está
   * en el cuadro, y **no había forma de liberarla**, porque el operativo que la retenía
   * ya no aparecía en ninguna pantalla.
   *
   * `conduccionesDelDia`, el equivalente para conductores, sí lo filtraba desde M-17.
   * Misma regla, dos implementaciones, una correcta.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  async asignacionesDelDia(
    funcionarioIds: number[],
    fecha: Date,
    excluirOperativoId?: number,
  ): Promise<AsignacionDelDia[]> {
    if (funcionarioIds.length === 0) return [];

    const filas = await this.prisma.asignacionPersonal.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        operativo: {
          activo: true,
          cuadro: { fecha },
          id: excluirOperativoId ? { not: excluirOperativoId } : undefined,
        },
      },
      select: {
        funcionarioId: true,
        // Ventana PROPIA de la persona en ese operativo (2026-09-08). Si es NULL cumple la
        // del operativo; si tiene una, las reglas de descanso (RN-28 solapamiento, RN-36
        // jornada) se cuentan sobre su turno real, no sobre el del operativo entero.
        horaInicio: true,
        horaFin: true,
        operativo: {
          select: {
            id: true,
            identificador: true,
            horaInicio: true,
            horaFin: true,
            duracionHoras: true,
          },
        },
      },
    });

    return filas.map((fila) => {
      const tienePropio = fila.horaInicio !== null && fila.horaFin !== null;
      const horaInicio = fila.horaInicio ?? fila.operativo.horaInicio;
      const horaFin = fila.horaFin ?? fila.operativo.horaFin;
      // Con ventana propia las horas se recalculan sobre ella; sin ella se reutiliza la
      // columna derivada del operativo para no recomponer el rango por gusto.
      const horas = tienePropio
        ? RangoHorario.de(horaInicio, horaFin).duracionHoras
        : Number(fila.operativo.duracionHoras);

      return {
        funcionarioId: fila.funcionarioId,
        operativoId: fila.operativo.id,
        identificador: fila.operativo.identificador,
        horaInicio,
        horaFin,
        horas,
      };
    });
  }

  /**
   * Horas que cada persona ya tiene asignadas en el PERÍODO [desde, hasta] (equidad de carga,
   * 2026-09-25). Por lote, como el resto. Usa la ventana PROPIA de la persona cuando la tiene
   * (igual que `asignacionesDelDia`), para que las horas sean las reales. El servicio le resta las
   * del día que se registra, para no contarlas dos veces.
   */
  async horasAsignadasEnPeriodo(
    funcionarioIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<Map<number, number>> {
    if (funcionarioIds.length === 0) return new Map();

    const filas = await this.prisma.asignacionPersonal.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        operativo: {
          activo: true,
          cuadro: { fecha: { gte: desde, lte: hasta } },
        },
      },
      select: {
        funcionarioId: true,
        horaInicio: true,
        horaFin: true,
        operativo: {
          select: { horaInicio: true, horaFin: true, duracionHoras: true },
        },
      },
    });

    const porPersona = new Map<number, number>();
    for (const fila of filas) {
      const tienePropio = fila.horaInicio !== null && fila.horaFin !== null;
      const horaInicio = fila.horaInicio ?? fila.operativo.horaInicio;
      const horaFin = fila.horaFin ?? fila.operativo.horaFin;
      const horas = tienePropio
        ? RangoHorario.de(horaInicio, horaFin).duracionHoras
        : Number(fila.operativo.duracionHoras);
      porPersona.set(
        fila.funcionarioId,
        (porPersona.get(fila.funcionarioId) ?? 0) + horas,
      );
    }
    return porPersona;
  }

  /**
   * Cuántos OPERATIVOS activos tiene asignados cada persona en el período (semana/mes). Es el
   * conteo que acompaña a las horas: el índice de carga se mide en horas, pero la pantalla también
   * muestra «cuántos operativos» para leerlo de un vistazo. Mismo `where` que las horas —una
   * asignación por operativo—, contando filas en vez de sumar duraciones.
   */
  async operativosAsignadosEnPeriodo(
    funcionarioIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<Map<number, number>> {
    if (funcionarioIds.length === 0) return new Map();

    const filas = await this.prisma.asignacionPersonal.groupBy({
      by: ['funcionarioId'],
      where: {
        funcionarioId: { in: funcionarioIds },
        operativo: {
          activo: true,
          cuadro: { fecha: { gte: desde, lte: hasta } },
        },
      },
      _count: { _all: true },
    });

    return new Map(filas.map((fila) => [fila.funcionarioId, fila._count._all]));
  }

  /** RN-24. Última patrulla de cada persona, del historial consolidado. */
  async ultimasPatrullas(
    funcionarioIds: number[],
    hasta: Date,
  ): Promise<Map<number, Date>> {
    if (funcionarioIds.length === 0) return new Map();

    const filas = await this.prisma.historialJornada.findMany({
      where: {
        funcionarioId: { in: funcionarioIds },
        fuePatrulla: true,
        fecha: { lte: hasta },
      },
      select: { funcionarioId: true, fecha: true },
      orderBy: { fecha: 'desc' },
    });

    const porPersona = new Map<number, Date>();
    for (const fila of filas) {
      if (!porPersona.has(fila.funcionarioId)) {
        porPersona.set(fila.funcionarioId, fila.fecha);
      }
    }
    return porPersona;
  }

  /** RN-25. Salidas pesadas de cada persona dentro del período de cómputo. */
  async salidasPesadasEnPeriodo(
    funcionarioIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<Map<number, number>> {
    if (funcionarioIds.length === 0) return new Map();

    const filas = await this.prisma.historialJornada.groupBy({
      by: ['funcionarioId'],
      where: {
        funcionarioId: { in: funcionarioIds },
        fecha: { gte: desde, lte: hasta },
        OR: [{ fueNocturna: true }, { fueFinSemana: true }],
      },
      _count: { _all: true },
    });

    return new Map(filas.map((fila) => [fila.funcionarioId, fila._count._all]));
  }

  // ─────────────────────── Conductores (por tramos, 2026-10-14) ───────────────────────
  //
  // Desde el 2026-10-14 la ocupación de quien conduce sale SOLO de `t_tramo_transporte`: un
  // operativo «dejar y retirar» ocupa al conductor en sus dos tramos, no en todo su horario. Todas
  // las consultas son POR LOTE (una por señal para todos los conductores), no una por conductor.
  // Los tramos de un operativo retirado (`oper_activo` en falso) no cuentan: salió del cuadro.

  /** Nombre de cada conductor, para redactar los veredictos. */
  async nombresDeConductores(
    conductorIds: number[],
  ): Promise<Map<number, string>> {
    if (conductorIds.length === 0) return new Map();
    const filas = await this.prisma.conductor.findMany({
      where: { id: { in: conductorIds } },
      select: { id: true, nombreCompleto: true },
    });
    return new Map(filas.map((fila) => [fila.id, fila.nombreCompleto]));
  }

  /**
   * RN-44. Las patrullas que condujo cada conductor entre dos fechas: un TRAMO suyo en un operativo
   * vigente de un formulario de patrulla. Devuelve el operativo para que el bloque que se está
   * asignando no cuente contra sí mismo.
   */
  async patrullasDeConductores(
    conductorIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<{ conductorId: number; fecha: Date; operativoId: number }[]> {
    if (conductorIds.length === 0) return [];
    const filas = await this.prisma.tramoTransporte.findMany({
      where: {
        conductorId: { in: conductorIds },
        fecha: { gte: desde, lte: hasta },
        operativo: { activo: true, formulario: { esPatrulla: true } },
      },
      select: { conductorId: true, fecha: true, operativoId: true },
    });
    return filas
      .filter((fila) => fila.conductorId !== null && fila.operativoId !== null)
      .map((fila) => ({
        conductorId: fila.conductorId as number,
        fecha: fila.fecha,
        operativoId: fila.operativoId as number,
      }));
  }

  /**
   * Horas al volante de cada conductor ESE día (semáforo de carga, advisory): la suma de sus
   * TRAMOS, no la duración de los operativos enteros. Incluye las TAREAS de taller, que también
   * son conducir.
   */
  async horasConducidasDelDiaDeVarios(
    conductorIds: number[],
    fecha: Date,
  ): Promise<Map<number, number>> {
    if (conductorIds.length === 0) return new Map();

    const filas = await this.prisma.tramoTransporte.findMany({
      where: {
        conductorId: { in: conductorIds },
        fecha,
        OR: [{ operativoId: null }, { operativo: { activo: true } }],
      },
      select: { conductorId: true, horaInicio: true, horaFin: true },
    });

    const horas = new Map<number, number>();
    for (const fila of filas) {
      if (fila.conductorId === null) continue;
      horas.set(
        fila.conductorId,
        (horas.get(fila.conductorId) ?? 0) +
          duracionEnHoras(fila.horaInicio, fila.horaFin),
      );
    }
    return horas;
  }

  /**
   * Los operativos que cada conductor condujo en el período (al menos un tramo suyo), con su fecha
   * y si fueron nocturnos. Uno por par conductor–operativo: dos tramos del mismo operativo son UNA
   * salida. El servicio cuenta las PESADAS (nocturnas o de fin de semana) con `esFinDeSemana`: una
   * sola definición de «fin de semana».
   *
   * SE CUENTA EN VIVO, SIN PROYECCIÓN PERSISTIDA, y es deliberado: son pocas filas por conductor y
   * la DAF planifica sobre el cuadro de mañana, todavía abierto; una proyección que solo contara
   * los cuadros cerrados dejaría el tope (RN-25) sin efecto justo cuando se está decidiendo.
   */
  async salidasDeConductoresEnPeriodo(
    conductorIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<SalidaDeConductor[]> {
    if (conductorIds.length === 0) return [];

    const filas = await this.prisma.tramoTransporte.findMany({
      where: {
        conductorId: { in: conductorIds },
        fecha: { gte: desde, lte: hasta },
        operativo: { activo: true },
      },
      select: {
        conductorId: true,
        operativoId: true,
        fecha: true,
        operativo: { select: { esNocturno: true } },
      },
    });

    const vistos = new Set<string>();
    const salidas: SalidaDeConductor[] = [];
    for (const fila of filas) {
      if (fila.conductorId === null || fila.operativoId === null) continue;
      const clave = `${fila.conductorId}-${fila.operativoId}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      salidas.push({
        conductorId: fila.conductorId,
        operativoId: fila.operativoId,
        fecha: fila.fecha,
        esNocturno: fila.operativo?.esNocturno ?? false,
      });
    }
    return salidas;
  }
}
