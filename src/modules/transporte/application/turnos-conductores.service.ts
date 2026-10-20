/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: turnos-conductores.service.ts
 * Responsabilidad: Componer la matriz mensual de turnos de los conductores y editar sus celdas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ES EL ESPEJO DE LA COBERTURA POR TURNOS DE INSTRUCCIÓN (`cobertura-turnos.service.ts`), con los
 * turnos de la DAF: DIA, NOCHE, ECU_NOCHE, LIBRE y ADMINISTRATIVO. Las ausencias (vacaciones,
 * reposo…) se DERIVAN de la disponibilidad del conductor y se superponen: no se editan aquí.
 *
 * PUBLICAR HABILITA (2026-10-07): la planificación, la evaluación (`FUERA_DE_TURNO`,
 * `LIBRE_NO_ACTIVADO`), la capacidad y el optimizador leen SOLO los turnos de un mes publicado
 * (`politicas/publicacion-turnos.ts`). Aquí, en la matriz, el borrador se ve y se edita. El reporte
 * (xlsx/pdf) solo se emite publicado.
 *
 * «Proponer el mes» (`politicas/propuesta-turnos.policy.ts`) llena el mes con ciclo, mínimos,
 * descanso y reparto; como «Continuar rotación», NO escribe.
 */

import { Injectable } from '@nestjs/common';
import {
  AccionAuditoria,
  EstadoCoberturaMes,
  TurnoConductor,
} from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import {
  ReglaNegocioError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { generarDocumento } from '../../documentos/application/motor-documento';
import { interpretarMes } from '../../talento-operativo/application/cobertura-turnos.service';
import {
  proponerRotacion,
  type DiaRotacion,
} from '../../talento-operativo/application/politicas/cobertura-rotacion.policy';
import type { Autor } from '../../operativos/application/operativos.service';
import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { ParametrosTransporteService } from './parametros-transporte.service';
import { exportarTurnosConductoresXlsx } from './turnos-conductores-exportador';
import { definicionTurnosConductoresPdf } from './turnos-conductores-pdf';
import { leerHojaHorario } from './turnos-conductores-importador';
import {
  previsualizarHorario,
  type PreviaImportacion,
} from './politicas/importar-horario';
import {
  diaDeSemana,
  proponerMes,
  type CeldaMes,
  type ResultadoPropuestaMes,
} from './politicas/propuesta-turnos.policy';
import { estaPublicado } from './politicas/publicacion-turnos';

export interface CeldaTurnoConductor {
  fecha: string;
  /** DIA | NOCHE | ECU_NOCHE | LIBRE | ADMINISTRATIVO | ausencia (VACACIONES…) | null. */
  estado: string | null;
  esAusencia: boolean;
}

export interface FilaConductor {
  conductorId: number;
  nombre: string;
  sector: string | null;
  tipoContrato: string | null;
  celdas: CeldaTurnoConductor[];
}

export interface TotalDiaConductores {
  fecha: string;
  dia: number;
  noche: number;
  ecuNoche: number;
  libre: number;
  administrativo: number;
  ausencias: number;
  sinTurno: number;
  /** Si el día queda por debajo del mínimo configurado (la noche cuenta NOCHE + ECU NOCHE). */
  bajoMinimo: { dia: boolean; noche: boolean };
}

export interface MatrizTurnosConductores {
  mes: string;
  dias: string[];
  conductores: FilaConductor[];
  totales: TotalDiaConductores[];
  estadoMes: EstadoCoberturaMes;
  /** Mínimos por día de la semana (L..D) de DAF_MIN_CONDUCTORES_DIA/NOCHE; null = sin configurar. */
  minimos: { dia: number[] | null; noche: number[] | null };
}

export type FormatoReporte = 'xlsx' | 'pdf';

export interface CeldaLoteConductor {
  conductorId: number;
  fecha: string;
  turno: TurnoConductor | null;
}

export interface ResultadoLoteConductores {
  aplicadas: number;
  omitidas: { conductorId: number; fecha: string; motivo: string }[];
}

const DIAS_PREVIOS = 31;

interface DiaResuelto {
  fecha: string;
  turno: TurnoConductor | null;
  ausencia: string | null;
}

@Injectable()
export class TurnosConductoresService {
  constructor(
    private readonly repositorio: PlanificacionTransporteRepository,
    private readonly auditoria: AuditoriaService,
    private readonly parametros: ParametrosTransporteService,
  ) {}

  async matriz(mes: string): Promise<MatrizTurnosConductores> {
    const { desde, hasta } = limitesMes(mes);
    const previo = sumarDias(desde, -DIAS_PREVIOS);
    const dias = rangoDeFechas(desde, hasta);
    const [conductores, resueltos, estadoMes, reglas] = await Promise.all([
      this.repositorio.conductoresActivos(),
      this.resolverDias(previo, hasta),
      this.repositorio.estadoMes(mes),
      this.parametros.leerRotacion(),
    ]);

    const totales: TotalDiaConductores[] = dias.map((fecha) => ({
      fecha,
      dia: 0,
      noche: 0,
      ecuNoche: 0,
      libre: 0,
      administrativo: 0,
      ausencias: 0,
      sinTurno: 0,
      bajoMinimo: { dia: false, noche: false },
    }));

    const filas = conductores.map((c): FilaConductor => {
      const delMes = (resueltos.get(c.id) ?? []).slice(DIAS_PREVIOS);
      return {
        conductorId: c.id,
        nombre: c.nombreCompleto,
        sector: c.sector,
        tipoContrato: c.tipoContrato,
        celdas: dias.map((fecha, indice) => {
          const dia = delMes[indice] ?? { fecha, turno: null, ausencia: null };
          const total = totales[indice];
          if (dia.ausencia) {
            total.ausencias += 1;
            return { fecha, estado: dia.ausencia, esAusencia: true };
          }
          switch (dia.turno) {
            case TurnoConductor.DIA:
              total.dia += 1;
              break;
            case TurnoConductor.NOCHE:
              total.noche += 1;
              break;
            case TurnoConductor.ECU_NOCHE:
              total.ecuNoche += 1;
              break;
            case TurnoConductor.LIBRE:
              total.libre += 1;
              break;
            case TurnoConductor.ADMINISTRATIVO:
              total.administrativo += 1;
              break;
            default:
              total.sinTurno += 1;
          }
          return { fecha, estado: dia.turno, esAusencia: false };
        }),
      };
    });

    for (const total of totales) {
      const semana = diaDeSemana(total.fecha);
      total.bajoMinimo = {
        dia:
          reglas.minimosDia !== null && total.dia < reglas.minimosDia[semana],
        noche:
          reglas.minimosNoche !== null &&
          total.noche + total.ecuNoche < reglas.minimosNoche[semana],
      };
    }

    return {
      mes,
      dias,
      conductores: filas,
      totales,
      estadoMes,
      minimos: { dia: reglas.minimosDia, noche: reglas.minimosNoche },
    };
  }

  /**
   * «Proponer el mes» (2026-10-07): ciclo de cada conductor (historial → patrón → últimos 14
   * días), mínimos por día, descanso y reparto. Solo celdas vacías salvo `rehacerTodo`; nunca
   * ausencias. NO escribe.
   */
  async proponerMes(
    mes: string,
    rehacerTodo = false,
  ): Promise<ResultadoPropuestaMes> {
    const { desde, hasta } = limitesMes(mes);
    const previo = sumarDias(desde, -DIAS_PREVIOS);
    const [conductores, resueltos, reglas] = await Promise.all([
      this.repositorio.conductoresActivos(),
      this.resolverDias(previo, hasta),
      this.parametros.leerRotacion(),
    ]);
    const aCelda = (d: DiaResuelto): CeldaMes =>
      d.ausencia ? 'AUSENCIA' : d.turno;
    return proponerMes({
      dias: rangoDeFechas(desde, hasta),
      conductores: conductores.map((c) => {
        const suyos = resueltos.get(c.id) ?? [];
        return {
          conductorId: c.id,
          patron: c.patronRotacion,
          historial: suyos.slice(0, DIAS_PREVIOS).map(aCelda),
          mes: suyos.slice(DIAS_PREVIOS).map(aCelda),
        };
      }),
      reglas,
      rehacerTodo,
    });
  }

  /** Fija o LIMPIA (`null`) el turno de un conductor en un día. No sobre un día de ausencia. */
  async editarCelda(
    conductorId: number,
    fecha: string,
    turno: TurnoConductor | null,
    autor: Autor,
  ): Promise<void> {
    const resultado = await this.editarLote(
      [{ conductorId, fecha, turno }],
      autor,
    );
    if (resultado.omitidas.length > 0) {
      throw new ValidacionError(resultado.omitidas[0].motivo, {
        conductorId,
        fecha,
      });
    }
  }

  /** Lote: aplica las válidas en UNA transacción y devuelve las omitidas con su motivo. */
  async editarLote(
    celdas: CeldaLoteConductor[],
    autor: Autor,
  ): Promise<ResultadoLoteConductores> {
    if (celdas.length === 0) return { aplicadas: 0, omitidas: [] };
    const conFecha = celdas.map((c) => ({
      ...c,
      dia: interpretarFecha(c.fecha),
    }));
    const minimo = conFecha.reduce(
      (m, c) => (c.dia < m ? c.dia : m),
      conFecha[0].dia,
    );
    const maximo = conFecha.reduce(
      (m, c) => (c.dia > m ? c.dia : m),
      conFecha[0].dia,
    );
    const [conductores, ausencias] = await Promise.all([
      this.repositorio.conductoresActivos(),
      this.repositorio.ausenciasConductoresEnRango(minimo, maximo),
    ]);
    const activos = new Set(conductores.map((c) => c.id));

    const omitidas: ResultadoLoteConductores['omitidas'] = [];
    const validas: typeof conFecha = [];
    for (const celda of conFecha) {
      if (!activos.has(celda.conductorId)) {
        omitidas.push({
          conductorId: celda.conductorId,
          fecha: celda.fecha,
          motivo: 'El conductor no existe o está dado de baja.',
        });
      } else if (
        ausencias.some(
          (a) =>
            a.conductorId === celda.conductorId &&
            cubre(a.desde, a.hasta, celda.fecha),
        )
      ) {
        omitidas.push({
          conductorId: celda.conductorId,
          fecha: celda.fecha,
          motivo:
            'Ese día el conductor tiene una ausencia registrada (vacaciones, reposo…). Se registra en Flota y garajes › Conductores › Ausencias, no en la matriz de turnos.',
        });
      } else {
        validas.push(celda);
      }
    }

    if (validas.length > 0) {
      const meses = [...new Set(validas.map((c) => c.fecha.slice(0, 7)))];
      await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
        for (const celda of validas) {
          await this.repositorio.guardarTurno(
            celda.conductorId,
            celda.dia,
            celda.turno,
            autor.usuarioId,
            cliente,
          );
        }
        for (const mes of meses)
          await this.repositorio.marcarMesConCambios(mes, cliente);
        await this.auditoria.registrar(
          {
            entidad: 't_turno_conductor',
            entidadId: validas[0].conductorId,
            accion: AccionAuditoria.ACTUALIZAR,
            cambios: [{ campo: 'celdas', valorNuevo: String(validas.length) }],
            usuario: autor.usuarioId,
            rol: autor.rol,
          },
          cliente,
        );
      });
    }
    return { aplicadas: validas.length, omitidas };
  }

  /** «Continuar rotación»: propone el turno de cada celda VACÍA siguiendo el ciclo. No escribe. */
  async proponerRotacion(
    mes: string,
    conductorIds?: number[],
  ): Promise<{
    propuestas: { conductorId: number; fecha: string; turno: TurnoConductor }[];
    conductores: number;
    omitidas: number;
  }> {
    const { desde, hasta } = limitesMes(mes);
    const previo = sumarDias(desde, -DIAS_PREVIOS);
    const [conductores, resueltos] = await Promise.all([
      this.repositorio.conductoresActivos(),
      this.resolverDias(previo, hasta),
    ]);
    const propuestas: {
      conductorId: number;
      fecha: string;
      turno: TurnoConductor;
    }[] = [];
    let cuantos = 0;
    let omitidas = 0;
    for (const c of conductores) {
      if (conductorIds && !conductorIds.includes(c.id)) continue;
      const dias = resueltos.get(c.id) ?? [];
      const resultado = proponerRotacion<TurnoConductor>(
        dias.map(
          (d): DiaRotacion<TurnoConductor> =>
            d.ausencia ? 'AUSENCIA' : d.turno,
        ),
        DIAS_PREVIOS,
      );
      if (resultado.propuestas.length === 0) continue;
      cuantos += 1;
      omitidas += resultado.omitidas;
      for (const p of resultado.propuestas) {
        propuestas.push({
          conductorId: c.id,
          fecha: dias[p.indice].fecha,
          turno: p.estado,
        });
      }
    }
    return { propuestas, conductores: cuantos, omitidas };
  }

  async publicarMes(
    mes: string,
    autor: Autor,
  ): Promise<{ estadoMes: EstadoCoberturaMes; celdasVacias: number }> {
    limitesMes(mes);
    await this.repositorio.publicarMes(mes, autor.usuarioId);
    const matriz = await this.matriz(mes);
    return {
      estadoMes: matriz.estadoMes,
      celdasVacias: matriz.totales.reduce((s, t) => s + t.sinTurno, 0),
    };
  }

  /**
   * Vista previa de la importación del HORARIO de la DAF (2026-10-06). NO escribe: devuelve qué
   * celdas se aplicarían y los errores por fila; la escritura es el lote de siempre.
   */
  async previsualizarImportacion(
    mes: string,
    contenido: Buffer,
  ): Promise<PreviaImportacion> {
    const { desde, hasta } = limitesMes(mes);
    const [hoja, conductores, ausencias] = await Promise.all([
      leerHojaHorario(contenido),
      this.repositorio.conductoresActivos(),
      this.repositorio.ausenciasConductoresEnRango(desde, hasta),
    ]);
    return previsualizarHorario({
      mes,
      hoja,
      conductores: conductores.map((c) => ({
        id: c.id,
        cedula: c.cedula,
        nombreCompleto: c.nombreCompleto,
      })),
      ausencias: ausencias.map((a) => ({
        conductorId: a.conductorId,
        desde: claveFecha(a.desde),
        hasta: claveFecha(a.hasta),
      })),
    });
  }

  /** El reporte del mes, en Excel o PDF. Solo de un mes PUBLICADO: si no, 409 (2026-10-07). */
  async exportar(
    mes: string,
    formato: FormatoReporte = 'xlsx',
  ): Promise<Buffer> {
    const matriz = await this.matriz(mes);
    if (!estaPublicado(matriz.estadoMes)) {
      throw new ReglaNegocioError(
        CODIGOS_ERROR.MES_NO_PUBLICADO,
        'Publique el mes antes de exportar el reporte',
        { mes, estadoMes: matriz.estadoMes },
      );
    }
    return formato === 'pdf'
      ? generarDocumento(definicionTurnosConductoresPdf(matriz))
      : exportarTurnosConductoresXlsx(matriz);
  }

  /** Turno y ausencia de cada conductor y día del rango. Dos consultas en lote. */
  private async resolverDias(
    desde: Date,
    hasta: Date,
  ): Promise<Map<number, DiaResuelto[]>> {
    const [turnos, ausencias, conductores] = await Promise.all([
      this.repositorio.turnosEnRango(desde, hasta),
      this.repositorio.ausenciasConductoresEnRango(desde, hasta),
      this.repositorio.conductoresActivos(),
    ]);
    const turnoDe = new Map<string, TurnoConductor>();
    for (const t of turnos)
      turnoDe.set(`${t.conductorId}|${claveFecha(t.fecha)}`, t.turno);
    const fechas = rangoDeFechas(desde, hasta);
    const porConductor = new Map<number, DiaResuelto[]>();
    for (const { id } of conductores) {
      const suyas = ausencias.filter((a) => a.conductorId === id);
      porConductor.set(
        id,
        fechas.map((fecha) => ({
          fecha,
          turno: turnoDe.get(`${id}|${fecha}`) ?? null,
          ausencia:
            suyas.find((a) => cubre(a.desde, a.hasta, fecha))?.estado ?? null,
        })),
      );
    }
    return porConductor;
  }
}

// ─────────────────────── Fechas (AAAA-MM-DD, UTC, sin huso) ───────────────────────

function limitesMes(mes: string): { desde: Date; hasta: Date } {
  const { anio, mesNum, cantidadDias } = interpretarMes(mes);
  return {
    desde: new Date(Date.UTC(anio, mesNum - 1, 1)),
    hasta: new Date(Date.UTC(anio, mesNum - 1, cantidadDias)),
  };
}

function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * 86_400_000);
}

function claveFecha(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function rangoDeFechas(desde: Date, hasta: Date): string[] {
  const fechas: string[] = [];
  for (let dia = desde; dia <= hasta; dia = sumarDias(dia, 1))
    fechas.push(claveFecha(dia));
  return fechas;
}

function cubre(desde: Date, hasta: Date, dia: string): boolean {
  return claveFecha(desde) <= dia && dia <= claveFecha(hasta);
}

function interpretarFecha(texto: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) {
    throw new ValidacionError(
      `«${texto}» no es una fecha válida. Se escribe como AAAA-MM-DD.`,
      {
        fecha: texto,
      },
    );
  }
  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) {
    throw new ValidacionError(`La fecha ${texto} no existe.`, { fecha: texto });
  }
  return fecha;
}
