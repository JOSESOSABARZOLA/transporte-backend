/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: configurar-orden-cuadro.dto.ts
 * Responsabilidad: Los tres datos del memorando que son del DÍA, no de cada orden.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * El NUT y «elaborado por» los comparten TODAS las órdenes de una jornada (D13): se configuran una
 * vez por cuadro. El número de memorando se movió a los DATOS GENERALES de la plantilla (2026-10-02).
 * Los dos son opcionales; lo que no venga —o venga vacío— queda «sin configurar» (NULL) y el
 * documento lo resalta como `[Etiqueta]` (D14). Igual que `EditarMemorandoDto`, es una clase con
 * decoradores porque `forbidNonWhitelisted` del ValidationPipe global rechaza cualquier campo no
 * declarado aquí.
 */

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConfigurarOrdenCuadroDto {
  @IsOptional() @IsString() @MaxLength(120) nut?: string;
  @IsOptional() @IsString() @MaxLength(200) elaboradoPor?: string;
}
