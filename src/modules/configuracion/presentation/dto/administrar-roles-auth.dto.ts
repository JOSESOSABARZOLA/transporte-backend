/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Homologación de roles
 * Archivo: administrar-roles-auth.dto.ts
 * Responsabilidad: Declarar el contrato de administración de la correspondencia con Auth.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * ORDEN DE LOS DECORADORES. class-validator informa las restricciones en orden inverso al
 * de declaración y el filtro muestra la primera como `mensaje`. El mensaje que debe leer
 * el administrador se declara EL ÚLTIMO. Misma convención que en los catálogos.
 *
 * `idAuth` SE ENVÍA Y NO SE GENERA. Es el identificador que Auth central asigna al rol, y
 * el administrador lo copia de allí. Por eso va en el cuerpo del alta y es la llave.
 */

import { RolDepartamental } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

export class CrearRolAuthDto {
  @IsPositive({
    message: 'El identificador del rol en Auth debe ser un número positivo.',
  })
  @IsInt({
    message: 'El identificador del rol en Auth debe ser un número entero.',
  })
  idAuth!: number;

  @MaxLength(120, {
    message: 'El nombre del rol no puede superar los 120 caracteres.',
  })
  @IsNotEmpty({
    message: 'Escriba el nombre del rol tal como aparece en Auth central.',
  })
  @IsString({
    message: 'Escriba el nombre del rol tal como aparece en Auth central.',
  })
  nombreAuth!: string;

  @IsEnum(RolDepartamental, {
    message: 'Elija a qué rol del Cuadro de Colores corresponde.',
  })
  rol!: RolDepartamental;

  @IsOptional()
  @IsPositive({
    message: 'El subsistema debe ser un número positivo. SIGOC es el 11.',
  })
  @IsInt({
    message: 'El subsistema debe ser un número entero. SIGOC es el 11.',
  })
  subsistema?: number;
}

export class ActualizarRolAuthDto {
  @IsOptional()
  @MaxLength(120, {
    message: 'El nombre del rol no puede superar los 120 caracteres.',
  })
  @IsNotEmpty({ message: 'Si envía el nombre del rol, no puede ir vacío.' })
  @IsString({ message: 'Si envía el nombre del rol, no puede ir vacío.' })
  nombreAuth?: string;

  @IsOptional()
  @IsEnum(RolDepartamental, {
    message: 'Elija a qué rol del Cuadro de Colores corresponde.',
  })
  rol?: RolDepartamental;

  @IsOptional()
  @IsBoolean({ message: 'El estado activo se indica como verdadero o falso.' })
  activo?: boolean;
}
