/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: administrar-usuarios.dto.ts
 * Responsabilidad: Declarar el contrato de administración de cuentas.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * ORDEN DE LOS DECORADORES. class-validator informa las restricciones en orden inverso al
 * de declaración y el filtro muestra la primera como `mensaje`. El mensaje que debe leer
 * el administrador se declara EL ÚLTIMO. Misma convención que en catálogos y ventanas.
 *
 * EL CORREO NO SE EDITA, y por eso no aparece en el DTO de edición: es la llave natural
 * de la cuenta y con la que se sembraban antes. Cambiarlo no sería corregir una cuenta,
 * sería crear otra.
 *
 * `funcionarioCedula` ACEPTA NULO A PROPÓSITO. Dirección y administración no salen a
 * operativos y no reciben órdenes de servicio: exigirles ficha sería inventar un dato.
 */

import { RolDepartamental } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// El formato de cédula es el MISMO que en el alta de personal: se importa de su único sitio
// (`reglas-personal`, Opción B) en vez de repetir el patrón aquí.
import {
  LONGITUD_CEDULA,
  PATRON_CEDULA,
} from '../../../talento-operativo/application/reglas-personal';

export class CrearUsuarioDto {
  @MaxLength(160, { message: 'El correo no puede superar los 160 caracteres.' })
  @IsEmail({}, { message: 'Escriba un correo institucional válido.' })
  correo!: string;

  @MaxLength(160, { message: 'El nombre no puede superar los 160 caracteres.' })
  @IsNotEmpty({ message: 'Escriba el nombre completo de la persona.' })
  @IsString({ message: 'Escriba el nombre completo de la persona.' })
  nombre!: string;

  @ArrayNotEmpty({
    message:
      'Elija al menos un rol: sin ninguno, esta persona no podrá trabajar.',
  })
  @IsEnum(RolDepartamental, {
    each: true,
    message: 'Elija los roles con los que esta persona trabajará en el cuadro.',
  })
  @IsArray({ message: 'Los roles se envían como una lista.' })
  roles!: RolDepartamental[];

  @IsOptional()
  @MaxLength(120, {
    message: 'El usuario de Auth no puede superar los 120 caracteres.',
  })
  @IsString({
    message: 'Escriba el usuario con el que esta persona entra a Auth central.',
  })
  identificadorAd?: string | null;

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== null && valor !== '')
  @Matches(PATRON_CEDULA, {
    message: `La cédula son ${LONGITUD_CEDULA} dígitos, sin guiones ni espacios.`,
  })
  funcionarioCedula?: string | null;
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @MaxLength(160, { message: 'El nombre no puede superar los 160 caracteres.' })
  @IsNotEmpty({ message: 'Si envía el nombre, no puede ir vacío.' })
  @IsString({ message: 'Si envía el nombre, no puede ir vacío.' })
  nombre?: string;

  @IsOptional()
  @ArrayNotEmpty({
    message:
      'Elija al menos un rol: sin ninguno, esta persona no podrá trabajar.',
  })
  @IsEnum(RolDepartamental, {
    each: true,
    message: 'Elija los roles con los que esta persona trabajará en el cuadro.',
  })
  @IsArray({ message: 'Los roles se envían como una lista.' })
  roles?: RolDepartamental[];

  @IsOptional()
  @MaxLength(120, {
    message: 'El usuario de Auth no puede superar los 120 caracteres.',
  })
  @IsString({
    message: 'Escriba el usuario con el que esta persona entra a Auth central.',
  })
  identificadorAd?: string | null;

  @IsOptional()
  @ValidateIf((_objeto, valor) => valor !== null && valor !== '')
  @Matches(PATRON_CEDULA, {
    message: `La cédula son ${LONGITUD_CEDULA} dígitos, sin guiones ni espacios.`,
  })
  funcionarioCedula?: string | null;

  @IsOptional()
  @IsBoolean({ message: 'El estado activo se indica como verdadero o falso.' })
  activo?: boolean;
}
