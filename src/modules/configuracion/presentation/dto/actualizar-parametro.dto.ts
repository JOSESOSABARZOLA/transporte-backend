/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: actualizar-parametro.dto.ts
 * Responsabilidad: Declarar el contrato de modificación de un parámetro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * UNA SOLA PROPIEDAD. Con `forbidNonWhitelisted`, cualquier intento de cambiar el
 * tipo, el rango o la clave desde la petición se rechaza con 400. El rango lo fija
 * el diseño, no quien edita el valor.
 *
 * ORDEN DE LOS DECORADORES. class-validator informa las restricciones en orden
 * inverso al de declaración, y el filtro muestra la primera como `mensaje`. Cuando
 * la propiedad llega vacía fallan las tres a la vez, así que la que debe leer el
 * funcionario —«Indique el nuevo valor»— se declara al final. Verificado en el
 * caso 3d de M06_PARAMETROS_POLITICA.md.
 */

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ActualizarParametroDto {
  @MaxLength(120, {
    message: 'El valor del parámetro no puede superar los 120 caracteres.',
  })
  @IsString({ message: 'El valor del parámetro debe ser texto.' })
  @IsNotEmpty({ message: 'Indique el nuevo valor del parámetro.' })
  valor: string;
}
