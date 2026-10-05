/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: editar-memorando.dto.ts
 * Responsabilidad: Los campos que la Dirección puede completar del memorando antes de generarlo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-15
 *
 * TODOS OPCIONALES, y NINGUNO es la asignación. El editor completa los huecos (número de
 * memorando, NUT, firmante…) y puede ajustar los textos legales; los operativos y el nombre
 * del destinatario **no están aquí**: los re-deriva el servidor del código de la orden, para
 * que editar el documento no permita inventar a quién ni a qué se le asigna (RN-51).
 *
 * `forbidNonWhitelisted` del ValidationPipe global exige que sea una clase con decoradores:
 * cualquier campo que no esté declarado aquí hace que la petición se rechace.
 */

import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EditarMemorandoDto {
  @IsOptional() @IsString() @MaxLength(120) numeroMemorando?: string;
  @IsOptional() @IsString() @MaxLength(120) numeroOrden?: string;
  @IsOptional() @IsString() @MaxLength(120) nut?: string;
  @IsOptional() @IsString() @MaxLength(120) paraCargo?: string;
  @IsOptional() @IsString() @MaxLength(200) paraDependencia?: string;
  @IsOptional() @IsString() @MaxLength(200) direccionResponsable?: string;
  @IsOptional() @IsString() @MaxLength(200) firmanteNombre?: string;
  @IsOptional() @IsString() @MaxLength(120) firmanteCargo?: string;
  @IsOptional() @IsString() @MaxLength(200) firmanteDependencia?: string;
  @IsOptional() @IsString() @MaxLength(200) elaboradoPor?: string;
  @IsOptional() @IsString() @MaxLength(60) siglasUnidad?: string;
}
