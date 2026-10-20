/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.dto.ts
 * Responsabilidad: Validar los contratos de candidatos, vehículos que salen y emisión de hojas de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * Ninguno toca `ActualizarTransporteDto` (regla 3): cada escritura nueva de la DAF tiene su propio
 * contrato y su propio endpoint.
 */

import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Query de `GET /transporte/candidatos/:operativoId`. */
export class CandidatosQueryDto {
  @Matches(PATRON_FECHA, { message: 'La fecha se escribe como AAAA-MM-DD.' })
  fecha!: string;
}

/**
 * Query de `GET /transporte/huecos/:fecha` (2026-10-14). Sin filtros, todos los conductores y
 * vehículos activos del día. Con `zonalId`, cada hueco trae además los minutos APROVECHABLES para
 * un servicio en esa zonal (descontando los traslados reales de ida y vuelta).
 */
export class HuecosQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Indique el conductor con su identificador.' })
  @Min(1, { message: 'Indique el conductor con su identificador.' })
  conductorId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Indique el vehículo con su identificador.' })
  @Min(1, { message: 'Indique el vehículo con su identificador.' })
  vehiculoId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Indique la zonal con su identificador.' })
  @Min(1, { message: 'Indique la zonal con su identificador.' })
  zonalId?: number;
}

/** Query de `GET /transporte/conductores/:id/huecos-libres` (2026-10-14). */
export class HuecosConductorQueryDto {
  @Matches(PATRON_FECHA, { message: 'La fecha se escribe como AAAA-MM-DD.' })
  @IsDateString(
    { strict: true },
    { message: 'La fecha indicada no existe en el calendario.' },
  )
  fecha!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Indique la zonal con su identificador.' })
  @Min(1, { message: 'Indique la zonal con su identificador.' })
  zonalId?: number;
}

/** Cuerpo de `PUT /transporte/vehiculos-jornada/:fecha`: la lista de los que SALEN. */
export class ConfirmarVehiculosDto {
  @IsArray({ message: 'Los vehículos deben llegar como lista.' })
  @ArrayMaxSize(500, { message: 'Como máximo 500 vehículos.' })
  @IsInt({ each: true, message: 'Cada vehículo debe ser un identificador.' })
  saleIds!: number[];

  /** Nota opcional de la DAF; se suma a la lista de placas que no salen. */
  @IsOptional()
  @MaxLength(120, { message: 'La observación no supera los 120 caracteres.' })
  @IsString({ message: 'La observación debe ser texto.' })
  observacion?: string | null;
}

/** Cuerpo de `POST /transporte/hojas-ruta/:fecha/emitir`. Sin conductor, se emiten todas. */
export class EmitirHojasDto {
  @IsOptional()
  @IsInt({ message: 'El conductor debe ser un identificador.' })
  conductorId?: number;
}
