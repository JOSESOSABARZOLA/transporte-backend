/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Historial de jornada
 * Archivo: historial-jornada.service.ts
 * Responsabilidad: Consolidar la jornada cerrada y responder a las políticas de descanso.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES UNA PROYECCIÓN, NO UNA ENTIDAD. No guarda hechos nuevos: resume los que ya están
 * en los operativos. De ahí salen las tres decisiones que gobiernan este archivo.
 *
 * 1. SE RECALCULA ENTERA, nunca se incrementa. Reabrir un cuadro, borrar un operativo
 *    y volver a cerrar deja a esa persona con horas que ya no hizo si la proyección se
 *    va sumando. Es el mismo criterio que FASE3 §OV-06 fija para el conjunto de
 *    alertas: *el recálculo total es deliberado; mantenerlas de forma incremental
 *    produce estados residuales cuando la condición que las originó desaparece*.
 *
 * 2. NO SE AUDITA. La auditoría demuestra quién cambió qué; aquí no cambia nadie nada:
 *    es un cálculo derivado que se puede regenerar entero desde su fuente. Lo que sí
 *    queda auditado es el cierre del cuadro que lo disparó, en M-13. Duplicar la traza
 *    solo añadiría ruido a la tabla que sirve para pedir cuentas.
 *
 * 3. NO TIENE ENDPOINTS, y es una decisión del negocio, no un olvido. **RN-35: el
 *    acumulado de salidas no se muestra nunca en la interfaz.** Alimenta la validación
 *    que protege a la persona, no una pantalla donde alguien pueda leer cuántas
 *    guardias lleva encima.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * CUÁNDO SE EJECUTA. Al cerrarse el cuadro, y **después** de que la transacción del
 * cierre haya confirmado: la regla 6 de CLAUDE.md dice que los eventos se emiten tras
 * confirmar, nunca dentro. Mientras `cuadro-diario` (M-13) no exista, no hay bus de
 * eventos —incorporarlo sería una dependencia nueva—, así que M-13 invocará
 * `consolidarJornada(fecha)` directamente. Si algún día se aprueba un bus, lo único
 * que cambia es quién llama a este método.
 */

import { Injectable } from '@nestjs/common';

import { LoggerService } from '../../../common/logger/logger.service';
import { HistorialJornadaRepository } from '../infrastructure/historial-jornada.repository';
import { consolidar, type JornadaConsolidada } from './reglas-historial';

/** Lo que dejó la consolidación, para el registro y para las pruebas. */
export interface ResultadoConsolidacion {
  fecha: string;
  personas: number;
  operativos: number;
  retiradas: number;
}

/** Período sobre el que se cuentan las salidas pesadas. RN-37. */
export interface PeriodoComputo {
  desde: Date;
  hasta: Date;
}

@Injectable()
export class HistorialJornadaService {
  constructor(
    private readonly repositorio: HistorialJornadaRepository,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Rehace el historial de una jornada a partir de sus operativos.
   *
   * Idempotente por construcción: ejecutarlo dos veces sobre la misma fecha deja el
   * mismo resultado. No hace falta saber si el cuadro se cerró por primera vez o por
   * tercera.
   */
  async consolidarJornada(fecha: Date): Promise<ResultadoConsolidacion> {
    const aportes = await this.repositorio.aportesDeLaJornada(fecha);
    const jornadas = consolidar(aportes, fecha);

    const retiradas = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        for (const jornada of jornadas) {
          await this.repositorio.guardar(fecha, jornada, cliente);
        }

        // Toda la proyección de esa fecha en una sola transacción: un fallo a medias
        // dejaría a unas personas con la jornada nueva y a otras con la anterior, y
        // las reglas de descanso se evaluarían contra un día inconsistente.
        return this.repositorio.retirarAusentes(
          fecha,
          jornadas.map((jornada) => jornada.funcionarioId),
          cliente,
        );
      },
    );

    const resultado: ResultadoConsolidacion = {
      fecha: comoFecha(fecha),
      personas: jornadas.length,
      operativos: aportes.length,
      retiradas,
    };

    this.logger.log('Historial de jornada consolidado', { ...resultado });
    return resultado;
  }

  // ─────────── Lo que consultan las políticas de descanso (M-12) ───────────

  /**
   * RN-24. Fecha de la última patrulla de la persona, o `null` si nunca salió.
   *
   * Devuelve la FECHA y no el registro entero: quien pregunta necesita saber si fue
   * ayer, no cuántas horas hizo ese día.
   */
  async obtenerUltimaPatrulla(funcionarioId: number): Promise<Date | null> {
    const ultima = await this.repositorio.ultimaPatrulla(funcionarioId);
    return ultima?.fecha ?? null;
  }

  /** RN-25. Salidas nocturnas o de fin de semana dentro del período de cómputo. */
  async contarSalidasPesadas(
    funcionarioId: number,
    periodo: PeriodoComputo,
  ): Promise<number> {
    return this.repositorio.contarSalidasPesadas(
      funcionarioId,
      periodo.desde,
      periodo.hasta,
    );
  }

  /**
   * RN-36. Horas que la persona ya tiene comprometidas ese día.
   *
   * Cero si no hay historial: una persona sin jornada consolidada no ha salido, y
   * devolver cero es exacto, no una suposición.
   */
  async obtenerHorasDelDia(
    funcionarioId: number,
    fecha: Date,
  ): Promise<number> {
    const jornada = await this.repositorio.buscarDelDia(funcionarioId, fecha);
    return jornada ? Number(jornada.horasJornada) : 0;
  }

  /** Jornadas consolidadas de una fecha. Para diagnóstico y pruebas. */
  async obtenerJornadaDe(fecha: Date): Promise<JornadaConsolidada[]> {
    const filas = await this.repositorio.listarDeFecha(fecha);

    return filas.map((fila) => ({
      funcionarioId: fila.funcionarioId,
      fuePatrulla: fila.fuePatrulla,
      fueNocturna: fila.fueNocturna,
      fueFinSemana: fila.fueFinSemana,
      horasJornada: Number(fila.horasJornada),
      operativos: fila.operativos,
    }));
  }
}

function comoFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}
