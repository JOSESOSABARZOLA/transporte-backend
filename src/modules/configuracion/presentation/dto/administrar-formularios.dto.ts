/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administrar-formularios.dto.ts
 * Responsabilidad: Validar el alta y la edición de un formulario desde la pantalla.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-29
 *
 * EL NÚMERO Y EL CÓDIGO SOLO VIAJAN AL CREAR. Los referencian los operativos y la identidad
 * legible del formulario, así que son inmutables tras el alta. Desde el 2026-10-13 la edición
 * los DECLARA solo para rechazarlos con un mensaje claro (`CampoFijo`): antes los rechazaba
 * `forbidNonWhitelisted` con el texto genérico de class-validator, en inglés.
 *
 * LAS ÁREAS NO VIAJAN NI AL CREAR NI AL EDITAR (2026-10-13). Se configuran solo en Catálogos del
 * cuadro (`PUT /administracion/formularios/:codigo/areas`): una sola fuente de verdad. Un
 * formulario nuevo nace sin áreas, y si el cuerpo las trae se responde 400.
 *
 * LOS COLORES SE VALIDAN DOS VECES: aquí el formato hexadecimal (para no chocar con el CHECK
 * de la base) y en el servicio que el trío pertenezca a la PALETA (`esColorDePaleta`), que es
 * la regla de verdad. El manual de marca no admite colores fuera de la paleta.
 */

import {
  PoliticaVehiculo,
  TipoTransporte,
  RolDepartamental,
} from '@prisma/client';
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

import { MENSAJES_CAMPO_FIJO } from '../../application/politicas/formulario-admin';

/** Un color hexadecimal de seis dígitos, el mismo formato que exige el CHECK de la base. */
const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * Declara un campo que NO se acepta por esta vía: si llega con cualquier valor, 400 con su
 * mensaje. Ausente, no se valida.
 */
function CampoFijo(mensaje: string): PropertyDecorator {
  return (objetivo, propiedad) => {
    Equals(undefined, { message: mensaje })(objetivo, propiedad);
    ValidateIf((_objeto, valor) => valor !== undefined)(objetivo, propiedad);
  };
}

export class CrearFormularioDto {
  @Max(99, { message: 'El número del formulario va del 1 al 99.' })
  @Min(1, { message: 'El número del formulario va del 1 al 99.' })
  @IsInt({ message: 'El número del formulario es un entero.' })
  numero!: number;

  @MaxLength(40, { message: 'El código no puede superar los 40 caracteres.' })
  @IsNotEmpty({ message: 'Indique el código del formulario.' })
  @IsString({ message: 'El código debe ser texto.' })
  codigo!: string;

  @MaxLength(160, { message: 'El nombre no puede superar los 160 caracteres.' })
  @IsNotEmpty({ message: 'Indique el nombre del formulario.' })
  @IsString({ message: 'El nombre debe ser texto.' })
  nombre!: string;

  @Matches(HEX, {
    message: 'El color de fondo debe ser un color de la paleta.',
  })
  @IsString({ message: 'El color de fondo debe ser texto.' })
  colorFondo!: string;

  @Matches(HEX, {
    message: 'El color de acento debe ser un color de la paleta.',
  })
  @IsString({ message: 'El color de acento debe ser texto.' })
  colorAcento!: string;

  @MaxLength(40, {
    message: 'El nombre del color no puede superar los 40 caracteres.',
  })
  @IsNotEmpty({ message: 'Indique el nombre del color.' })
  @IsString({ message: 'El nombre del color debe ser texto.' })
  colorNombre!: string;

  @IsEnum(RolDepartamental, { message: 'El rol dueño indicado no existe.' })
  rolDueno!: RolDepartamental;

  @MaxLength(12, { message: 'El prefijo no puede superar los 12 caracteres.' })
  @IsNotEmpty({ message: 'Indique el prefijo del identificador.' })
  @IsString({ message: 'El prefijo debe ser texto.' })
  prefijo!: string;

  /** Se configuran en Catálogos del cuadro: el formulario nace sin áreas. */
  @CampoFijo(MENSAJES_CAMPO_FIJO.areas)
  areas?: unknown;

  @IsEnum(PoliticaVehiculo, {
    message: 'La política de vehículo indicada no existe.',
  })
  @IsOptional()
  politicaVehiculo?: PoliticaVehiculo;

  /** Tipo de transporte que toma un operativo nuevo que no lo indica (2026-10-07). */
  @IsEnum(TipoTransporte, {
    message: 'El tipo de transporte por defecto indicado no existe.',
  })
  @IsOptional()
  tipoTransportePorDefecto?: TipoTransporte;

  @IsInt({ message: 'El orden es un entero.' })
  @IsOptional()
  orden?: number;

  @IsBoolean({ message: 'El condicionante nocturno es verdadero o falso.' })
  @IsOptional()
  condicionanteNoct?: boolean;

  @IsBoolean({ message: 'El indicador de patrulla es verdadero o falso.' })
  @IsOptional()
  esPatrulla?: boolean;

  @IsBoolean({ message: 'La captura libre de punto es verdadera o falsa.' })
  @IsOptional()
  capturaLibrePunto?: boolean;

  @IsBoolean({ message: 'La captura libre de tipo es verdadera o falsa.' })
  @IsOptional()
  capturaLibreTipo?: boolean;

  @IsBoolean({ message: 'El punto manual es verdadero o falso.' })
  @IsOptional()
  puntoManual?: boolean;

  @IsBoolean({ message: 'El filtro de personal por rol es verdadero o falso.' })
  @IsOptional()
  filtraPersonalPorRol?: boolean;

  @IsBoolean({ message: 'El tipo de control múltiple es verdadero o falso.' })
  @IsOptional()
  tipoControlMultiple?: boolean;

  @IsBoolean({
    message: 'La opción de varios por persona es verdadera o falsa.',
  })
  @IsOptional()
  variosPorPersona?: boolean;

  @IsBoolean({
    message: 'La opción de cantidad por persona es verdadera o falsa.',
  })
  @IsOptional()
  cantidadPorPersona?: boolean;
}

/**
 * Todo opcional: se modifica lo que llega y se conserva lo demás. `numero`, `codigo` y `areas`
 * se declaran solo para rechazarlos. `activo` permite reactivar un formulario dado de baja.
 */
export class ActualizarFormularioDto {
  @CampoFijo(MENSAJES_CAMPO_FIJO.numero)
  numero?: unknown;

  @CampoFijo(MENSAJES_CAMPO_FIJO.codigo)
  codigo?: unknown;

  @MaxLength(160, { message: 'El nombre no puede superar los 160 caracteres.' })
  @IsNotEmpty({ message: 'El nombre no puede quedar vacío.' })
  @IsString({ message: 'El nombre debe ser texto.' })
  @IsOptional()
  nombre?: string;

  @Matches(HEX, {
    message: 'El color de fondo debe ser un color de la paleta.',
  })
  @IsString({ message: 'El color de fondo debe ser texto.' })
  @IsOptional()
  colorFondo?: string;

  @Matches(HEX, {
    message: 'El color de acento debe ser un color de la paleta.',
  })
  @IsString({ message: 'El color de acento debe ser texto.' })
  @IsOptional()
  colorAcento?: string;

  @MaxLength(40, {
    message: 'El nombre del color no puede superar los 40 caracteres.',
  })
  @IsNotEmpty({ message: 'El nombre del color no puede quedar vacío.' })
  @IsString({ message: 'El nombre del color debe ser texto.' })
  @IsOptional()
  colorNombre?: string;

  @IsEnum(RolDepartamental, { message: 'El rol dueño indicado no existe.' })
  @IsOptional()
  rolDueno?: RolDepartamental;

  @MaxLength(12, { message: 'El prefijo no puede superar los 12 caracteres.' })
  @IsNotEmpty({ message: 'El prefijo no puede quedar vacío.' })
  @IsString({ message: 'El prefijo debe ser texto.' })
  @IsOptional()
  prefijo?: string;

  /** Se configuran en Catálogos del cuadro. */
  @CampoFijo(MENSAJES_CAMPO_FIJO.areas)
  areas?: unknown;

  @IsEnum(PoliticaVehiculo, {
    message: 'La política de vehículo indicada no existe.',
  })
  @IsOptional()
  politicaVehiculo?: PoliticaVehiculo;

  /** Tipo de transporte que toma un operativo nuevo que no lo indica (2026-10-07). */
  @IsEnum(TipoTransporte, {
    message: 'El tipo de transporte por defecto indicado no existe.',
  })
  @IsOptional()
  tipoTransportePorDefecto?: TipoTransporte;

  @IsInt({ message: 'El orden es un entero.' })
  @IsOptional()
  orden?: number;

  @IsBoolean({ message: 'El condicionante nocturno es verdadero o falso.' })
  @IsOptional()
  condicionanteNoct?: boolean;

  @IsBoolean({ message: 'El indicador de patrulla es verdadero o falso.' })
  @IsOptional()
  esPatrulla?: boolean;

  @IsBoolean({ message: 'La captura libre de punto es verdadera o falsa.' })
  @IsOptional()
  capturaLibrePunto?: boolean;

  @IsBoolean({ message: 'La captura libre de tipo es verdadera o falsa.' })
  @IsOptional()
  capturaLibreTipo?: boolean;

  @IsBoolean({ message: 'El punto manual es verdadero o falso.' })
  @IsOptional()
  puntoManual?: boolean;

  @IsBoolean({ message: 'El filtro de personal por rol es verdadero o falso.' })
  @IsOptional()
  filtraPersonalPorRol?: boolean;

  @IsBoolean({ message: 'El tipo de control múltiple es verdadero o falso.' })
  @IsOptional()
  tipoControlMultiple?: boolean;

  @IsBoolean({
    message: 'La opción de varios por persona es verdadera o falsa.',
  })
  @IsOptional()
  variosPorPersona?: boolean;

  @IsBoolean({
    message: 'La opción de cantidad por persona es verdadera o falsa.',
  })
  @IsOptional()
  cantidadPorPersona?: boolean;

  @IsBoolean({ message: 'El estado del formulario es verdadero o falso.' })
  @IsOptional()
  activo?: boolean;
}
