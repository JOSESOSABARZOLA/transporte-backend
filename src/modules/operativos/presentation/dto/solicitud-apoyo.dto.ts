/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Solicitud de apoyo interdirección
 * Archivo: solicitud-apoyo.dto.ts
 * Responsabilidad: Declarar el contrato de la solicitud y su respuesta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * EL DTO NO INCLUYE `rolSolicitante` NI `estado`, y las dos ausencias son la misma idea:
 *
 *   · el solicitante lo resuelve `IdentidadGuard`, nunca el cuerpo. Si viajara, bastaría
 *     con alterarlo para pedir apoyo en nombre de otra dirección;
 *   · el estado nace en `SOLICITADA` y **no lo mueve nadie**, porque el flujo de
 *     aceptación y rechazo no está definido (PV-12). Aceptarlo aquí sería ofrecer una
 *     transición que el sistema no sabe honrar.
 *
 * Con `forbidNonWhitelisted`, enviar cualquiera de los dos produce `400
 * CAMPOS_NO_PERMITIDOS` con el campo nombrado.
 */

import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AreaPersonal,
  EstadoSolicitud,
  RolDepartamental,
} from '@prisma/client';

import type { SolicitudConOperativo } from '../../infrastructure/solicitud-apoyo.repository';

/** `sapo_cantidad` es `SMALLINT`. No es un límite del negocio, es de la columna. */
const MAXIMO_SMALLINT = 32767;

export class SolicitarApoyoDto {
  @IsEnum(RolDepartamental, {
    message: 'Indique una dirección válida a la que solicitar el apoyo.',
  })
  @IsNotEmpty({ message: 'Indique la dirección a la que solicita el apoyo.' })
  rolRequerido: RolDepartamental;

  @IsEnum(AreaPersonal, {
    message: 'El área de personal indicada no es válida.',
  })
  @IsOptional()
  areaRequerida?: AreaPersonal;

  @Max(MAXIMO_SMALLINT, {
    message: 'La cantidad solicitada es demasiado alta.',
  })
  @Min(1, { message: 'Solicite al menos una persona.' })
  @IsInt({ message: 'La cantidad de personal debe ser un número entero.' })
  @IsNotEmpty({ message: 'Indique cuántas personas necesita.' })
  cantidad: number;

  @MaxLength(400, {
    message: 'La observación no puede superar los 400 caracteres.',
  })
  @IsOptional()
  observacion?: string;
}

/** Criterios de la bandeja. */
export class FiltroSolicitudesDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  fecha?: string;

  @IsEnum(EstadoSolicitud, {
    message: 'El estado indicado no corresponde a una solicitud de apoyo.',
  })
  @IsOptional()
  @Type(() => String)
  estado?: EstadoSolicitud;
}

// ─────────────────────────── Respuesta ───────────────────────────

/**
 * La solicitud, con el contexto del operativo.
 *
 * La dirección requerida **no puede ver el operativo ajeno** (PER-02), así que la
 * solicitud tiene que traer lo que necesita para decidir a quién manda: qué operativo es,
 * de qué formulario, qué día y a qué hora. Sin eso, la bandeja es un rol y un número.
 */
export interface SolicitudApoyoResponseDto {
  id: number;
  estado: EstadoSolicitud;
  rolSolicitante: string;
  rolRequerido: string;
  areaRequerida: string | null;
  cantidad: number;
  observacion: string | null;
  creadoEn: string;
  operativo: {
    id: number;
    identificador: string;
    cuadroFecha: string;
    horario: string;
    formularioNombre: string;
    formularioCodigo: string;
  };
}

export function aSolicitudApoyoResponse(
  solicitud: SolicitudConOperativo,
): SolicitudApoyoResponseDto {
  const operativo = solicitud.operativo;

  return {
    id: solicitud.id,
    estado: solicitud.estado,
    rolSolicitante: solicitud.rolSolicitante,
    rolRequerido: solicitud.rolRequerido,
    areaRequerida: solicitud.areaRequerida,
    cantidad: solicitud.cantidad,
    observacion: solicitud.observacion,
    creadoEn: solicitud.creadoEn.toISOString(),
    operativo: {
      id: operativo.id,
      identificador: operativo.identificador,
      cuadroFecha: operativo.cuadro.fecha.toISOString().slice(0, 10),
      horario: `${operativo.horaInicio.replace(':', 'H')} A ${operativo.horaFin.replace(':', 'H')}`,
      formularioNombre: operativo.formulario.nombre,
      formularioCodigo: operativo.formulario.codigo,
    },
  };
}
