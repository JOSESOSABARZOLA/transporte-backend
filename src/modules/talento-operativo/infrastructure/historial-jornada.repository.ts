/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: historial-jornada.repository.ts
 * Responsabilidad: Leer los operativos de una jornada y escribir su proyección.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES EL ÚNICO REPOSITORIO QUE LEE TABLAS DE OTRO CONTEXTO, y conviene justificarlo.
 *
 * `t_historial_jornada` es una PROYECCIÓN: no guarda hechos nuevos, sino un resumen de
 * lo que ya está en `t_operativo` y `t_asignacion_personal`. Leer esas dos tablas es lo
 * que hace una proyección; si tuviera que pedir los datos a otro submódulo, ese otro
 * tendría que exponer un servicio que devolviera exactamente esta forma, y la
 * proyección viviría partida en dos.
 *
 * LO QUE SÍ SE RESPETA: no importa el repositorio de otro submódulo, no escribe en
 * ninguna tabla ajena y su lectura es de solo lectura. `operativos` (M-14) no sabe que
 * esto existe.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SIN ÍNDICES NUEVOS. `idx_historial_func_fecha (func_id, hist_fecha DESC)` cubre las
 * tres consultas de las políticas de descanso —última patrulla, salidas del período y
 * horas del día—, y `uq_historial_func_fecha` sostiene el `upsert`. Ambos vienen de
 * M-02.
 */

import { Injectable } from '@nestjs/common';
import type { HistorialJornada, Prisma } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AporteOperativo,
  JornadaConsolidada,
} from '../application/reglas-historial';

@Injectable()
export class HistorialJornadaRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────── Lectura de la fuente ───────────────────

  /**
   * Lo que cada persona hizo en la jornada, leído de los operativos de esa fecha.
   *
   * Una sola consulta con las dos uniones que hacen falta. La alternativa —traer los
   * operativos y luego sus asignaciones— serían dos viajes y un `N+1` cuando el cuadro
   * tiene cincuenta filas, que es lo normal.
   *
   * `activo: true` porque la baja del operativo es lógica y la asignación sobrevive a
   * ella. Sin el filtro, esta proyección consolidaba horas, patrullas y nocturnas de
   * operativos **retirados del cuadro**, y como es la fuente de las reglas de descanso
   * de los días siguientes, el error no se quedaba en la jornada: la arrastraba.
   */
  async aportesDeLaJornada(fecha: Date): Promise<AporteOperativo[]> {
    const asignaciones = await this.prisma.asignacionPersonal.findMany({
      where: { operativo: { activo: true, cuadro: { fecha } } },
      select: {
        funcionarioId: true,
        operativo: {
          select: {
            duracionHoras: true,
            esNocturno: true,
            formulario: { select: { esPatrulla: true } },
          },
        },
      },
    });

    return asignaciones.map((asignacion) => ({
      funcionarioId: asignacion.funcionarioId,
      horas: Number(asignacion.operativo.duracionHoras),
      esPatrulla: asignacion.operativo.formulario.esPatrulla,
      esNocturno: asignacion.operativo.esNocturno,
    }));
  }

  // ─────────────────── Escritura de la proyección ───────────────────

  /** `upsert` por persona y fecha: `uq_historial_func_fecha` lo garantiza. */
  async guardar(
    fecha: Date,
    jornada: JornadaConsolidada,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    const datos = {
      fuePatrulla: jornada.fuePatrulla,
      fueNocturna: jornada.fueNocturna,
      fueFinSemana: jornada.fueFinSemana,
      horasJornada: jornada.horasJornada,
      operativos: jornada.operativos,
      consolidadoEn: new Date(),
    };

    await cliente.historialJornada.upsert({
      where: {
        funcionarioId_fecha: { funcionarioId: jornada.funcionarioId, fecha },
      },
      update: datos,
      create: { funcionarioId: jornada.funcionarioId, fecha, ...datos },
    });
  }

  /**
   * Retira de esa fecha a quien ya no figura en el cuadro.
   *
   * Hace falta al reabrir y volver a cerrar: si un operativo se eliminó, la persona
   * conservaría horas que ya no hizo. La proyección se recalcula ENTERA, igual que el
   * conjunto de alertas de OV-06.
   */
  async retirarAusentes(
    fecha: Date,
    funcionarioIds: number[],
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await cliente.historialJornada.deleteMany({
      where: { fecha, funcionarioId: { notIn: funcionarioIds } },
    });
    return count;
  }

  // ─────────────────── Consultas de las políticas ───────────────────

  /** RN-24. Última jornada en la que la persona salió en patrulla. */
  async ultimaPatrulla(
    funcionarioId: number,
  ): Promise<HistorialJornada | null> {
    return this.prisma.historialJornada.findFirst({
      where: { funcionarioId, fuePatrulla: true },
      orderBy: { fecha: 'desc' },
    });
  }

  /** RN-25. Salidas nocturnas o de fin de semana dentro del período. */
  async contarSalidasPesadas(
    funcionarioId: number,
    desde: Date,
    hasta: Date,
  ): Promise<number> {
    return this.prisma.historialJornada.count({
      where: {
        funcionarioId,
        fecha: { gte: desde, lte: hasta },
        OR: [{ fueNocturna: true }, { fueFinSemana: true }],
      },
    });
  }

  /** RN-36. Lo que la persona ya acumuló ese día. */
  async buscarDelDia(
    funcionarioId: number,
    fecha: Date,
  ): Promise<HistorialJornada | null> {
    return this.prisma.historialJornada.findUnique({
      where: { funcionarioId_fecha: { funcionarioId, fecha } },
    });
  }

  async listarDeFecha(fecha: Date): Promise<HistorialJornada[]> {
    return this.prisma.historialJornada.findMany({ where: { fecha } });
  }
}
