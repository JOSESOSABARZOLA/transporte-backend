/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-turno.dto.ts
 * Responsabilidad: Validar la edición de una celda de la matriz de turnos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 */

import { DenominacionInstruccion, EstadoTurno } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Matches } from 'class-validator';

export class EditarCeldaCoberturaDto {
  @IsInt({ message: 'El funcionario debe ser un identificador.' })
  funcionarioId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha se escribe como AAAA-MM-DD.',
  })
  fecha!: string;

  @IsEnum(EstadoTurno, {
    message: 'El turno solo puede ser DIURNO, NOCTURNO o DESCANSO.',
  })
  estado!: EstadoTurno;
}

/** Zona y denominación de una persona de Instrucción (para agruparla en la matriz). */
export class DatosInstruccionDto {
  @IsInt({ message: 'La zona debe ser un identificador.' })
  @IsOptional()
  zonalId?: number | null;

  @IsEnum(DenominacionInstruccion, {
    message: 'La denominación indicada no existe.',
  })
  @IsOptional()
  denominacion?: DenominacionInstruccion | null;
}
