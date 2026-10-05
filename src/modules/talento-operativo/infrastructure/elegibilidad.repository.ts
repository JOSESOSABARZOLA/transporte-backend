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
 * LEE `t_operativo` Y `t_asignacion_personal`, con la misma licencia que
 * `HistorialJornadaRepository` y por el mismo motivo: las reglas de descanso necesitan
 * saber qué tiene ya asignado la persona ESE día, y el día en construcción todavía no
 * está consolidado en el historial. No importa el repositorio de otro submódulo ni
 * escribe fuera de su contexto.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoDisponibilidad,
  EstadoTurno,
  type Conductor,
  type Funcionario,
} from '@prisma/client';

import { RangoHorario } from '../../operativos/domain/rango-horario';
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

  // ─────────────────────── Conductores ───────────────────────

  async buscarConductor(id: number): Promise<Conductor | null> {
    return this.prisma.conductor.findUnique({ where: { id } });
  }

  async ausenciaDeConductor(
    conductorId: number,
    fecha: Date,
  ): Promise<AusenciaEnFecha | null> {
    const fila = await this.prisma.disponibilidad.findFirst({
      where: {
        conductorId,
        desde: { lte: fecha },
        hasta: { gte: fecha },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
      },
      select: { estado: true, hasta: true },
      orderBy: { hasta: 'desc' },
    });

    return fila ?? null;
  }

  /**
   * VAL-21 y VAL-22. Operativos que el conductor ya conduce ese día.
   *
   * `excluirOperativoId` sirve al reasignar: un operativo no se solapa consigo mismo, y
   * sin excluirlo cambiar de vehículo se rechazaría a sí mismo. Mismo criterio que
   * `asignacionesDelDia` para el personal.
   *
   * Los retirados no cuentan: `oper_activo` en falso significa que salió del cuadro.
   */
  async conduccionesDelDia(
    conductorId: number,
    fecha: Date,
    excluirOperativoId?: number,
  ): Promise<AsignacionDelDia[]> {
    const filas = await this.prisma.operativo.findMany({
      where: {
        conductorId,
        activo: true,
        cuadro: { fecha },
        id: excluirOperativoId ? { not: excluirOperativoId } : undefined,
      },
      select: {
        id: true,
        identificador: true,
        horaInicio: true,
        horaFin: true,
        duracionHoras: true,
      },
    });

    return filas.map((fila) => ({
      funcionarioId: conductorId,
      operativoId: fila.id,
      identificador: fila.identificador,
      horaInicio: fila.horaInicio,
      horaFin: fila.horaFin,
      horas: Number(fila.duracionHoras),
    }));
  }

  /**
   * RN-44. Última fecha en la que el conductor condujo en una patrulla.
   *
   * No hay proyección de conductores equivalente a `t_historial_jornada`, así que se
   * reconstruye desde los operativos que condujo. Son pocas filas por conductor.
   *
   * `activo: true` por lo mismo que en `asignacionesDelDia`: un operativo retirado no se
   * condujo, y contarlo como patrulla dejaba al conductor en descanso por un servicio que
   * nunca ocurrió.
   */
  async ultimaPatrullaDeConductor(
    conductorId: number,
    hasta: Date,
  ): Promise<Date | null> {
    const operativo = await this.prisma.operativo.findFirst({
      where: {
        conductorId,
        activo: true,
        formulario: { esPatrulla: true },
        cuadro: { fecha: { lte: hasta } },
      },
      select: { cuadro: { select: { fecha: true } } },
      orderBy: { cuadro: { fecha: 'desc' } },
    });

    return operativo?.cuadro.fecha ?? null;
  }

  /**
   * RN-25 aplicada al conductor. Salidas nocturnas o de fin de semana en el período.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * SE CUENTA DESDE `t_operativo`, SIN PROYECCIÓN PERSISTIDA, Y ES DELIBERADO.
   *
   * El personal tiene `t_historial_jornada`, una proyección que se consolida al cerrar el
   * cuadro y que guarda `hist_fue_nocturna` y `hist_fue_fin_semana`. La simetría invita a
   * crear su gemela para conductores.
   *
   * No hace falta, y este mismo archivo ya lo decidió así: `ultimaPatrullaDeConductor`
   * reconstruye RN-44 desde los operativos que condujo, «son pocas filas por conductor».
   * Vale igual aquí —treinta y cuatro conductores frente a cientos de funcionarios— y
   * evita una tabla, un servicio de consolidación y un enganche al cierre del cuadro que
   * habría que mantener sincronizados con la fuente.
   *
   * LA CONTRAPARTIDA, ESCRITA PARA QUE NADIE LA DESCUBRA TARDE: contar en vivo incluye
   * los operativos de un cuadro **todavía abierto**, mientras que la proyección del
   * personal solo cuenta los cerrados. Para esta regla es lo correcto —la DAF planifica
   * sobre el cuadro del día siguiente, que aún no está cerrado, y no contarlo dejaría el
   * tope sin efecto justo cuando se está decidiendo—.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * El fin de semana se decide en memoria: PostgreSQL podría hacerlo con `EXTRACT(DOW)`,
   * pero eso exigiría SQL crudo y `esFinDeSemana` ya existe, probada, en
   * `reglas-historial.ts`. Dos versiones de «qué es fin de semana» es justo lo que no
   * conviene tener.
   */
  async salidasPesadasDeConductor(
    conductorId: number,
    desde: Date,
    hasta: Date,
    excluirOperativoId?: number,
  ): Promise<{ fecha: Date; esNocturno: boolean }[]> {
    const filas = await this.prisma.operativo.findMany({
      where: {
        conductorId,
        activo: true,
        cuadro: { fecha: { gte: desde, lte: hasta } },
        id: excluirOperativoId ? { not: excluirOperativoId } : undefined,
      },
      select: { esNocturno: true, cuadro: { select: { fecha: true } } },
    });

    return filas.map((fila) => ({
      fecha: fila.cuadro.fecha,
      esNocturno: fila.esNocturno,
    }));
  }

  // ─────────────── Conductores · carga por lote (advisory) ───────────────
  //
  // Para el semáforo de carga del conductor (FRMS, 2026-09-24), que la DAF ve al asignar. Son
  // consultas POR LOTE —una por señal para todos los conductores del desplegable, no una por
  // conductor— por el mismo motivo que las del personal: el desplegable de flota es largo.

  /** Horas ya asignadas a cada conductor ESE día (suma de duraciones de sus operativos vigentes). */
  async horasConducidasDelDiaDeVarios(
    conductorIds: number[],
    fecha: Date,
  ): Promise<Map<number, number>> {
    if (conductorIds.length === 0) return new Map();

    const filas = await this.prisma.operativo.groupBy({
      by: ['conductorId'],
      where: {
        conductorId: { in: conductorIds },
        activo: true,
        cuadro: { fecha },
      },
      _sum: { duracionHoras: true },
    });

    return new Map(
      filas
        .filter((fila) => fila.conductorId !== null)
        .map((fila) => [
          fila.conductorId as number,
          Number(fila._sum.duracionHoras ?? 0),
        ]),
    );
  }

  /**
   * Salidas de cada conductor en el período, con su fecha y si fueron nocturnas. El servicio
   * cuenta las PESADAS (nocturnas o de fin de semana) con `esFinDeSemana`, igual que en el
   * veredicto individual: una sola definición de «fin de semana».
   */
  async salidasDeConductoresEnPeriodo(
    conductorIds: number[],
    desde: Date,
    hasta: Date,
  ): Promise<{ conductorId: number; fecha: Date; esNocturno: boolean }[]> {
    if (conductorIds.length === 0) return [];

    const filas = await this.prisma.operativo.findMany({
      where: {
        conductorId: { in: conductorIds },
        activo: true,
        cuadro: { fecha: { gte: desde, lte: hasta } },
      },
      select: {
        conductorId: true,
        esNocturno: true,
        cuadro: { select: { fecha: true } },
      },
    });

    return filas
      .filter((fila) => fila.conductorId !== null)
      .map((fila) => ({
        conductorId: fila.conductorId as number,
        fecha: fila.cuadro.fecha,
        esNocturno: fila.esNocturno,
      }));
  }
}
