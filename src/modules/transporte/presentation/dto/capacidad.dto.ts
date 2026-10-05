/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad.dto.ts
 * Responsabilidad: Declarar el contrato de la capacidad y su comparación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EL DTO NO INCLUYE `fecha` NI `declaradoPor`. La fecha va en la ruta —es el recurso— y
 * quien declara lo resuelve `IdentidadGuard`. Enviarlos produce `400
 * CAMPOS_NO_PERMITIDOS`, y sin ellos no hay forma de declarar capacidad en nombre de
 * otro ni para un día distinto del que se está viendo.
 */

import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import type { EstadoCapacidad } from '../../application/capacidad-flota.service';

/** `capa_vehiculos_habiles` es `SMALLINT`. Límite de la columna, no del negocio. */
const MAXIMO_SMALLINT = 32767;

export class DeclararCapacidadDto {
  @Max(MAXIMO_SMALLINT, { message: 'La cantidad declarada es demasiado alta.' })
  @Min(0, {
    message: 'Los vehículos hábiles no pueden ser un número negativo.',
  })
  @IsInt({ message: 'Los vehículos hábiles deben ser un número entero.' })
  @Type(() => Number)
  @IsNotEmpty({ message: 'Indique cuántos vehículos están hábiles ese día.' })
  vehiculosHabiles: number;

  @Max(MAXIMO_SMALLINT, { message: 'La cantidad declarada es demasiado alta.' })
  @Min(0, {
    message: 'Los conductores hábiles no pueden ser un número negativo.',
  })
  @IsInt({ message: 'Los conductores hábiles deben ser un número entero.' })
  @Type(() => Number)
  @IsNotEmpty({ message: 'Indique cuántos conductores están hábiles ese día.' })
  conductoresHabiles: number;

  @MaxLength(300, {
    message: 'La observación no puede superar los 300 caracteres.',
  })
  @IsOptional()
  observacion?: string;
}

// ─────────────────────────── Respuesta ───────────────────────────

/** Comparación de un recurso, tal como la pinta el indicador de P-03 y P-04. */
export interface HolguraDto {
  declarados: number;
  requeridos: number;
  excedente: number;
  suficiente: boolean;
}

export interface CapacidadResponseDto {
  fecha: string;
  /** `null` mientras la DAF no declare: la pantalla lo distingue de «cero hábiles». */
  declarada: {
    vehiculosHabiles: number;
    conductoresHabiles: number;
    observacion: string | null;
    declaradoPor: number;
    declaradoEn: string;
  } | null;
  demanda: { vehiculos: number; conductores: number };
  vehiculos: HolguraDto | null;
  conductores: HolguraDto | null;
  hayAdvertencia: boolean;
  /** VAL-24. Se muestra tal cual, y **no impide nada**. */
  advertencia: string | null;
}

export function aCapacidadResponse(
  estado: EstadoCapacidad,
): CapacidadResponseDto {
  return {
    fecha: estado.fecha.toISOString().slice(0, 10),
    declarada: estado.declarada
      ? {
          vehiculosHabiles: estado.declarada.vehiculosHabiles,
          conductoresHabiles: estado.declarada.conductoresHabiles,
          observacion: estado.declarada.observacion,
          declaradoPor: estado.declarada.declaradoPor,
          declaradoEn: estado.declarada.declaradoEn.toISOString(),
        }
      : null,
    demanda: {
      vehiculos: estado.vehiculosRequeridos,
      conductores: estado.vehiculosRequeridos,
    },
    vehiculos: estado.veredicto?.vehiculos ?? null,
    conductores: estado.veredicto?.conductores ?? null,
    hayAdvertencia: estado.veredicto?.hayAdvertencia ?? false,
    advertencia: estado.veredicto?.advertencia ?? null,
  };
}
