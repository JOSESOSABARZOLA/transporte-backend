/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administrar-areas.dto.ts
 * Responsabilidad: Validar el conjunto de áreas que se pide para un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * SE MANDA EL CONJUNTO ENTERO, no un alta ni una baja. El servidor iguala lo que hay a lo
 * que llega, y así no existe el instante intermedio en que el formulario se queda sin
 * ninguna área —que es un estado que la aplicación no sabe explicar—.
 *
 * `@IsEnum` sobre cada elemento es lo que impide que llegue un área inventada: la lista
 * de valores admitidos la da Prisma, no una constante escrita aquí, así que retirar un
 * área del enumerado la retira también de este contrato sin tocar este archivo.
 */

import { AreaPersonal } from '@prisma/client';
import { ArrayNotEmpty, IsArray, IsEnum } from 'class-validator';

export class ReemplazarAreasDto {
  /**
   * Las áreas que el formulario debe admitir a partir de ahora.
   *
   * `ArrayNotEmpty` rechaza la lista vacía aquí, en el borde, con un mensaje de campo. El
   * servicio la vuelve a comprobar y explica la consecuencia —el selector de personal se
   * queda vacío sin decir por qué—, porque un rechazo de formato y uno de negocio no se
   * leen igual.
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(AreaPersonal, { each: true })
  areas!: AreaPersonal[];
}
