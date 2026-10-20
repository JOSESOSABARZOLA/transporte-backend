/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: guardar-plantilla.dto.ts
 * Responsabilidad: Validar los apartados de la plantilla que la Dirección guarda.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-15
 */

import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class ApartadoDto {
  @IsString() @MaxLength(60) id!: string;
  @IsString() @MaxLength(200) titulo!: string;
  /** Etiqueta de la columna izquierda (2026-10-01). Opcional y aditivo. */
  @IsOptional() @IsString() @MaxLength(200) etiqueta?: string;
  @IsIn(['texto', 'lista', 'campos', 'operativos']) tipo!: string;
  @IsString() @MaxLength(8000) contenido!: string;
}

/**
 * Datos GENERALES del Director (2026-10-02): se guardan con la plantilla y valen para todas las
 * órdenes. La fecha del memorando es texto «AAAA-MM-DD» (o vacío). Todos opcionales: lo que no venga
 * queda vacío y la orden lo resalta como faltante de origen «plantilla».
 */
export class DatosGeneralesDto {
  @IsOptional() @IsString() @MaxLength(200) direccionResponsable?: string;
  @IsOptional() @IsString() @MaxLength(120) numeroMemorando?: string;
  @IsOptional() @IsString() @MaxLength(10) fechaMemorando?: string;
  @IsOptional() @IsString() @MaxLength(300) designado?: string;
  /**
   * Firmante del documento (2026-10-05). Viven en la plantilla junto al resto de datos generales;
   * faltaban aquí y `forbidNonWhitelisted` rechazaba con 400 la vista previa y el guardado.
   */
  @IsOptional() @IsString() @MaxLength(200) firmante?: string;
  @IsOptional() @IsString() @MaxLength(200) firmanteCargo?: string;
  @IsOptional() @IsString() @MaxLength(200) firmanteDependencia?: string;
  /**
   * TABLA DE CONTROL del final de cada orden (2026-10-08): «<accion>: <elaboradoPor>» y las siglas
   * de la unidad. La fecha se completa sola (la de emisión). Las siglas se guardan en mayúsculas.
   */
  @IsOptional() @IsString() @MaxLength(60) accion?: string;
  @IsOptional() @IsString() @MaxLength(200) elaboradoPor?: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @MaxLength(20)
  siglasUnidad?: string;
}

export class GuardarPlantillaDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => ApartadoDto)
  apartados!: ApartadoDto[];

  /** Bloque de datos generales del Director (opcional y aditivo). */
  @IsOptional()
  @ValidateNested()
  @Type(() => DatosGeneralesDto)
  datosGenerales?: DatosGeneralesDto;
}
