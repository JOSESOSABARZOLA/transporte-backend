/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.dto.ts
 * Responsabilidad: Validar la forma de las peticiones de la carga inicial desde Excel.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * Solo se valida la FORMA. El contenido de cada fila lo revalida `validarDatos` en el servidor:
 * lo que vuelve del navegador no se cree.
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  TIPOS_CARGA,
  type TipoCarga,
} from '../../application/politicas/carga-inicial';

const PATRON_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Campos de texto del multipart de `previsualizar` (`archivo` va aparte). */
export class PreviaCargaInicialDto {
  @IsIn(TIPOS_CARGA, {
    message: 'El tipo admite conductores, vehiculos, garajes o turnos.',
  })
  tipo!: TipoCarga;

  @IsOptional()
  @Matches(PATRON_MES, { message: 'El mes se escribe como AAAA-MM.' })
  mes?: string;
}

export class FilaCargaInicialDto {
  @IsInt({ message: 'Cada fila lleva su número.' })
  @Min(1)
  fila!: number;

  @IsObject({ message: 'Cada fila lleva sus datos.' })
  datos!: Record<string, unknown>;

  /** Lo que devolvió la vista previa; se admite y se ignora (se revalida). */
  @IsOptional()
  @IsBoolean()
  valido?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  errores?: string[];
}

export class AplicarCargaInicialDto extends PreviaCargaInicialDto {
  @IsArray({ message: 'Las filas deben llegar como lista.' })
  @ArrayMaxSize(2000, { message: 'Como máximo 2000 filas por carga.' })
  @ValidateNested({ each: true })
  @Type(() => FilaCargaInicialDto)
  filas!: FilaCargaInicialDto[];
}
