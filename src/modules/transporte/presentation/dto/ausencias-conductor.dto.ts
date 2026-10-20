/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ausencias de conductores
 * Archivo: ausencias-conductor.dto.ts
 * Responsabilidad: Validar el registro de una ausencia de conductor y dar forma a sus respuestas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-16
 *
 * LAS RESPUESTAS TIENEN LA MISMA FORMA QUE LAS DEL PERSONAL (`DisponibilidadResponseDto`,
 * `AusenciaDelMaestroResponseDto`), con `conductorId` en lugar de `funcionarioId`: así el
 * frontend usa el mismo panel de ausencias para los dos.
 */

import type { Disponibilidad, EstadoDisponibilidad } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

import {
  comoFechaIso,
  ESTADOS_QUE_EXCLUYEN,
  estadoDeAusencia,
  type EstadoDeAusencia,
} from '../../../../common/ausencias/reglas-ausencia';
import { fechaIsoEnZona } from '../../../../common/utilidades/marca-tiempo';
import type {
  AusenciaDeLaFlota,
  TramoDelConductor,
} from '../../infrastructure/ausencias-conductor.repository';

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MENSAJE_FECHA = 'La fecha se escribe como AAAA-MM-DD.';

export class CrearAusenciaConductorDto {
  /** RN-30: solo las situaciones que excluyen. Ni DISPONIBLE ni MANTENIMIENTO. */
  @IsIn(ESTADOS_QUE_EXCLUYEN, {
    message: `La situación admite estos valores: ${ESTADOS_QUE_EXCLUYEN.join(', ')}.`,
  })
  @IsNotEmpty({ message: 'Indique la situación del conductor.' })
  estado: EstadoDisponibilidad;

  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique desde qué día está ausente.' })
  desde: string;

  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsNotEmpty({ message: 'Indique hasta qué día está ausente.' })
  hasta: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @MaxLength(220, { message: 'El motivo no supera los 220 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  @IsOptional()
  motivo?: string | null;
}

/** `?desde=` de la lista de la flota. Opcional: por omisión, hoy en Quito. */
export class FiltroAusenciasFlotaDto {
  @Matches(PATRON_FECHA, { message: MENSAJE_FECHA })
  @IsOptional()
  desde?: string;
}

// ─────────────────────────── Respuestas ───────────────────────────

/** Una ausencia del conductor, con su motivo: la ve quien administra la flota. */
export interface AusenciaConductorResponseDto {
  id: number;
  conductorId: number;
  estado: EstadoDisponibilidad;
  desde: string;
  hasta: string;
  motivo: string | null;
  registradoPor: number;
  /** EN_CURSO · PROXIMA · PASADA respecto de hoy en Quito. Una PASADA no se quita. */
  momento: EstadoDeAusencia;
}

/** Una ausencia en la lista de la flota. Sin motivo. */
export interface AusenciaDeLaFlotaResponseDto {
  id: number;
  conductorId: number;
  estado: EstadoDisponibilidad;
  desde: string;
  hasta: string;
  momento: EstadoDeAusencia;
}

export interface TramoAfectadoResponseDto {
  operativoId: number;
  identificador: string;
  /** Fecha de la jornada, `AAAA-MM-DD`. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
}

/** Respuesta del registro: la ausencia y los tramos que ya tenía en esas fechas (A5). */
export interface AusenciaConductorRegistradaResponseDto extends AusenciaConductorResponseDto {
  tramosAfectados: TramoAfectadoResponseDto[];
}

export function aAusenciaConductorResponse(
  ausencia: Disponibilidad,
  hoy: string = fechaIsoEnZona(),
): AusenciaConductorResponseDto {
  const desde = comoFechaIso(ausencia.desde);
  const hasta = comoFechaIso(ausencia.hasta);
  return {
    id: ausencia.id,
    conductorId: ausencia.conductorId ?? 0,
    estado: ausencia.estado,
    desde,
    hasta,
    motivo: ausencia.motivo,
    registradoPor: ausencia.registradoPor,
    momento: estadoDeAusencia(desde, hasta, hoy),
  };
}

export function aAusenciaDeLaFlotaResponse(
  ausencia: AusenciaDeLaFlota,
  hoy: string = fechaIsoEnZona(),
): AusenciaDeLaFlotaResponseDto {
  const desde = comoFechaIso(ausencia.desde);
  const hasta = comoFechaIso(ausencia.hasta);
  return {
    id: ausencia.id,
    conductorId: ausencia.conductorId,
    estado: ausencia.estado,
    desde,
    hasta,
    momento: estadoDeAusencia(desde, hasta, hoy),
  };
}

export function aTramoAfectadoResponse(
  tramo: TramoDelConductor,
): TramoAfectadoResponseDto {
  return {
    operativoId: tramo.operativoId,
    identificador: tramo.identificador,
    fecha: comoFechaIso(tramo.fecha),
    horaInicio: tramo.horaInicio,
    horaFin: tramo.horaFin,
  };
}
