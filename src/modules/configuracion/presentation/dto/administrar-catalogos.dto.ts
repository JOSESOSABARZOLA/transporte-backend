/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administrar-catalogos.dto.ts
 * Responsabilidad: Declarar los contratos de administración de los tres catálogos.
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

// Un punto de encuentro pertenece a UN formulario (2026-09-29): lleva su `formularioId`,
// igual que el tipo de control. Ya no hay delimitación de varios formularios ni tabla
// puente. El formulario queda fijo tras crearse (lo referencian los operativos), así que
// solo el alta lo pide.
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

  @IsPositive({ message: 'El formulario se indica por su identificador.' })
  @IsInt({ message: 'El formulario se indica por su identificador.' })
  formularioId: number;
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
 * La zonal es un CATÁLOGO CERRADO hasta el 2026-09-04. Desde esa fecha el administrador
 * puede sumar zonales, y por eso existen estos contratos. Ver `zonales.controller.ts`.
 *
 * NO LLEVA CÓDIGO: se autogenera del nombre en el servidor y se comprueba único. Pedirlo
 * al administrador invitaba a duplicados y a códigos inconsistentes. Y al ACTUALIZAR solo
 * se admite el nombre —el código queda fijo tras crearse, porque lo referencian los
 * operativos— más `activo`, que es el camino de reactivación (mismo patrón que los puntos).
 */
export class CrearZonalDto {
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

// Un tipo de control pertenece a UN formulario (2026-09-07): lleva su `formularioId`, no
// una delimitación de varios como el punto y la institución.
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

  @IsPositive({ message: 'El formulario se indica por su identificador.' })
  @IsInt({ message: 'El formulario se indica por su identificador.' })
  formularioId: number;
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

// Una institución pertenece a UN formulario (2026-09-29): lleva su `formularioId`, igual
// que el punto y el tipo de control. El formulario queda fijo tras crearse.
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

  @IsPositive({ message: 'El formulario se indica por su identificador.' })
  @IsInt({ message: 'El formulario se indica por su identificador.' })
  formularioId: number;
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
