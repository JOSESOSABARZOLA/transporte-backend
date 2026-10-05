/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Contratos compartidos
 * Archivo: paginacion.dto.ts
 * Responsabilidad: Declarar los parámetros de paginación comunes a los listados.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Convención de docs/FASE4-arquitectura-tecnica.md §8.1: parámetros `pagina` y
 * `tamanio`, y respuesta con metadatos.
 */

import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginacionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'La página debe ser un número entero.' })
  @Min(1, { message: 'La página comienza en 1.' })
  pagina?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El tamaño de página debe ser un número entero.' })
  @Min(1, { message: 'El tamaño de página mínimo es 1.' })
  @Max(200, { message: 'El tamaño de página máximo es 200.' })
  tamanio?: number = 25;
}
