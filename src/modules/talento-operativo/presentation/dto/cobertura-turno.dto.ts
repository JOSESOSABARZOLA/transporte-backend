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
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class EditarCeldaCoberturaDto {
  @IsInt({ message: 'El funcionario debe ser un identificador.' })
  funcionarioId!: number;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha se escribe como AAAA-MM-DD.',
  })
  fecha!: string;

  /** `null` LIMPIA la celda (2026-10-05): el día queda sin turno, sin restricción de horario. */
  @ValidateIf((dto: EditarCeldaCoberturaDto) => dto.estado !== null)
  @IsEnum(EstadoTurno, {
    message:
      'El turno solo puede ser DIURNO, NOCTURNO o DESCANSO (o vacío para limpiar).',
  })
  estado!: EstadoTurno | null;
}

/** Edición en lote (2026-10-05): selección de rango, «Aplicar patrón», «Continuar rotación». */
export class EditarLoteCoberturaDto {
  @IsArray({ message: 'Las celdas deben llegar como lista.' })
  @ArrayMaxSize(3000, { message: 'Como máximo 3000 celdas por lote.' })
  @ValidateNested({ each: true })
  @Type(() => EditarCeldaCoberturaDto)
  celdas!: EditarCeldaCoberturaDto[];
}

/** El mes de la cobertura, «AAAA-MM». */
export class MesCoberturaDto {
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El mes se escribe como AAAA-MM.',
  })
  mes!: string;
}

/** «Continuar rotación»: el mes y, opcionalmente, a quiénes (por defecto, todo el personal). */
export class PropuestaRotacionDto extends MesCoberturaDto {
  @IsOptional()
  @IsArray({ message: 'Las personas deben llegar como lista.' })
  @ArrayMaxSize(1000)
  @IsInt({ each: true, message: 'Cada persona debe ser un identificador.' })
  funcionarioIds?: number[];
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
