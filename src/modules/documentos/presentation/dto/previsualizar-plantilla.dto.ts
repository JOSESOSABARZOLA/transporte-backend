/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: previsualizar-plantilla.dto.ts
 * Responsabilidad: Validar la vista previa de la plantilla EN BORRADOR (sin guardar).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * Es el MISMO contrato que `GuardarPlantillaDto`: los apartados y los datos generales que la
 * Dirección tiene en pantalla. Desde el 2026-10-05 la vista previa es siempre GENÉRICA: ya no hay
 * selector «con los datos de» ni persona real; los datos de la orden salen como marcadores grises.
 *
 * `codigo` SE ACEPTA Y SE IGNORA (compatibilidad, 2026-10-05). El editor anterior lo enviaba, y una
 * pestaña abierta antes de desplegar sigue ejecutando ese JavaScript: con `forbidNonWhitelisted` el
 * campo desconocido daba 400 y la vista previa no se generaba. Se valida (texto acotado) para no abrir
 * una puerta, pero el controlador no lo lee. Solo la vista previa lo tolera: guardar la plantilla
 * (`GuardarPlantillaDto`) sigue rechazándolo.
 */

import { IsOptional, IsString, MaxLength } from 'class-validator';

import { GuardarPlantillaDto } from './guardar-plantilla.dto';

export class PrevisualizarPlantillaDto extends GuardarPlantillaDto {
  /** Heredado del editor anterior: se admite por compatibilidad y NO se usa. */
  @IsOptional() @IsString() @MaxLength(120) codigo?: string;
}
