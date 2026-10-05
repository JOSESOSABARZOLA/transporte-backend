/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: completar-datos-persona.dto.ts
 * Responsabilidad: El único dato de la ficha del destinatario que puede faltar en una orden: su cargo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * E21 (origen 'persona'). El aviso de borrador agrupa los faltantes por quién los completa; los de la
 * PERSONA se resuelven con su cargo (el nombre y la dependencia se derivan siempre del servidor, RN-51,
 * así que no faltan en la práctica). El cargo es OBLIGATORIO: esta acción existe justo para completarlo.
 * Igual que el resto de DTO del módulo, es una clase con decoradores porque `forbidNonWhitelisted` del
 * ValidationPipe global rechaza cualquier campo no declarado aquí.
 */

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CompletarDatosPersonaDto {
  @IsString() @IsNotEmpty() @MaxLength(120) cargo!: string;
}
