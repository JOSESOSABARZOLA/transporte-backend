/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administrar-catalogos.dto.ts
 * Responsabilidad: Declarar los contratos de administración de los cuatro catálogos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ORDEN DE LOS DECORADORES. class-validator informa las restricciones en orden inverso
 * al de declaración y el filtro muestra la primera como `mensaje`. El mensaje que debe
 * leer el administrador se declara EL ÚLTIMO. Verificado en M-06 y comprobado aquí en
 * los casos 10 y 11 de M07_FORMULARIOS_CATALOGOS.md §7.
 *
 * NO HAY DTO PARA DAR DE BAJA. La baja es un `DELETE` sin cuerpo: lo único que se
 * necesita saber es cuál. Ver RF-058.
 */

import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// EL FORMULARIO VA EN LA RUTA, NO EN EL CUERPO (2026-10-13): `/administracion/catalogos/:codigo/…`.
// Cada valor se crea en el formulario de la ruta y queda fijo en él. No hay formularios
// adicionales: nada se copia ni se vincula entre formularios.
export class CrearPuntoDto {
  @MaxLength(200, {
    message: 'El nombre del punto no puede superar los 200 caracteres.',
  })
  @MinLength(3, { message: 'El nombre del punto es demasiado corto.' })
  @IsString({ message: 'El nombre del punto debe ser texto.' })
  @IsNotEmpty({ message: 'Indique el nombre del punto de encuentro.' })
  nombre: string;

  @IsPositive({ message: 'La zonal se indica por su identificador.' })
  @IsInt({ message: 'La zonal se indica por su identificador.' })
  @IsNotEmpty({ message: 'Indique a qué zonal pertenece el punto.' })
  zonalId: number;
}

export class ActualizarPuntoDto {
  @MaxLength(200, {
    message: 'El nombre del punto no puede superar los 200 caracteres.',
  })
  @MinLength(3, { message: 'El nombre del punto es demasiado corto.' })
  @IsString({ message: 'El nombre del punto debe ser texto.' })
  @IsOptional()
  nombre?: string;

  @IsPositive({ message: 'La zonal se indica por su identificador.' })
  @IsInt({ message: 'La zonal se indica por su identificador.' })
  @IsOptional()
  zonalId?: number;

  @IsBoolean({ message: 'El estado del punto es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}

/**
 * La zonal es DEL FORMULARIO desde el 2026-10-13 (`t_zonal_formulario`). El alta pide la ZONA DE
 * LA CIUDAD a la que corresponde —obligatoria: Transporte la usa para traslados y sector— y el
 * nombre que tendrá en el formulario. Al ACTUALIZAR solo cambian el nombre y `activo`; la zona
 * queda fija, porque la llevan sus puntos y los operativos.
 */
export class CrearZonalDto {
  @IsPositive({
    message: 'La zona de la ciudad se indica por su identificador.',
  })
  @IsInt({ message: 'La zona de la ciudad se indica por su identificador.' })
  @IsNotEmpty({ message: 'Indique la zona de la ciudad de la zonal.' })
  zonaId: number;

  @MaxLength(90, {
    message: 'El nombre de la zonal no puede superar los 90 caracteres.',
  })
  @MinLength(3, { message: 'El nombre de la zonal es demasiado corto.' })
  @IsString({ message: 'El nombre de la zonal debe ser texto.' })
  @IsNotEmpty({ message: 'Indique el nombre de la zonal.' })
  nombre: string;
}

export class ActualizarZonalDto {
  @MaxLength(90, {
    message: 'El nombre de la zonal no puede superar los 90 caracteres.',
  })
  @MinLength(3, { message: 'El nombre de la zonal es demasiado corto.' })
  @IsString({ message: 'El nombre de la zonal debe ser texto.' })
  @IsOptional()
  nombre?: string;

  @IsBoolean({ message: 'El estado de la zonal es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}

export class CrearTipoControlDto {
  @MaxLength(200, {
    message:
      'El nombre del tipo de control no puede superar los 200 caracteres.',
  })
  @MinLength(3, {
    message: 'El nombre del tipo de control es demasiado corto.',
  })
  @IsString({ message: 'El nombre del tipo de control debe ser texto.' })
  @IsNotEmpty({ message: 'Indique el nombre del tipo de control.' })
  nombre: string;
}

export class ActualizarTipoControlDto {
  @MaxLength(200, {
    message:
      'El nombre del tipo de control no puede superar los 200 caracteres.',
  })
  @MinLength(3, {
    message: 'El nombre del tipo de control es demasiado corto.',
  })
  @IsString({ message: 'El nombre del tipo de control debe ser texto.' })
  @IsOptional()
  nombre?: string;

  @IsBoolean({ message: 'El estado del tipo de control es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}

export class CrearInstitucionDto {
  @MaxLength(40, { message: 'La sigla no puede superar los 40 caracteres.' })
  @MinLength(2, { message: 'La sigla es demasiado corta.' })
  @IsString({ message: 'La sigla debe ser texto.' })
  @IsNotEmpty({ message: 'Indique la sigla de la institución.' })
  sigla: string;

  @MaxLength(200, {
    message: 'La denominación no puede superar los 200 caracteres.',
  })
  @MinLength(3, { message: 'La denominación es demasiado corta.' })
  @IsString({ message: 'La denominación debe ser texto.' })
  @IsNotEmpty({
    message: 'Indique la denominación completa de la institución.',
  })
  nombre: string;
}

export class ActualizarInstitucionDto {
  @MaxLength(40, { message: 'La sigla no puede superar los 40 caracteres.' })
  @MinLength(2, { message: 'La sigla es demasiado corta.' })
  @IsString({ message: 'La sigla debe ser texto.' })
  @IsOptional()
  sigla?: string;

  @MaxLength(200, {
    message: 'La denominación no puede superar los 200 caracteres.',
  })
  @MinLength(3, { message: 'La denominación es demasiado corta.' })
  @IsString({ message: 'La denominación debe ser texto.' })
  @IsOptional()
  nombre?: string;

  @IsBoolean({ message: 'El estado de la institución es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}
