/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: planificacion.dto.ts
 * Responsabilidad: Validar los contratos de tramos, evaluación, activación, traslados y turnos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Ninguno toca `ActualizarTransporteDto` (regla 3): cada escritura nueva de la DAF tiene su propio
 * contrato y su propio endpoint.
 */

import { TipoUbicacionVehiculo, TurnoConductor } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_MES = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Un bloque de operativos de una jornada (y, si se quiere, solo unos tramos suyos). */
export class BloqueOperativosDto {
  @Matches(PATRON_FECHA, { message: 'La fecha se escribe como AAAA-MM-DD.' })
  fecha!: string;

  @IsArray({ message: 'Los operativos deben llegar como lista.' })
  @ArrayMinSize(1, { message: 'Indique al menos un operativo.' })
  @ArrayMaxSize(50, { message: 'Como máximo 50 operativos por bloque.' })
  @IsInt({ each: true, message: 'Cada operativo debe ser un identificador.' })
  operativoIds!: number[];

  /** Solo estos tramos (p. ej. solo el «dejar» de un PMO). Deben ser de esos operativos. */
  @IsOptional()
  @IsArray({ message: 'Los tramos deben llegar como lista.' })
  @ArrayMaxSize(200)
  @IsInt({ each: true, message: 'Cada tramo debe ser un identificador.' })
  tramoIds?: number[];
}

/** Las placas del día para UN conductor y un bloque (sustitución de flota, 2026-10-15). */
export class EvaluarVehiculosDto extends BloqueOperativosDto {
  @IsInt({ message: 'Debe seleccionar un conductor.' })
  conductorId!: number;
}

export class AsignarBloqueDto extends BloqueOperativosDto {
  @IsInt({ message: 'Debe seleccionar un conductor.' })
  conductorId!: number;

  /** `null` = sin vehículo todavía (el operativo no se sincroniza hasta tener los dos). */
  @ValidateIf((dto: AsignarBloqueDto) => dto.vehiculoId !== null)
  @IsInt({ message: 'El vehículo seleccionado no es válido.' })
  vehiculoId!: number | null;
}

/**
 * Compartir unidad (2026-10-19): el operativo INVITADO viaja en la unidad (conductor y placa) del
 * ANFITRIÓN, que ya está asignado. La fecha sale de los operativos, no del cuerpo.
 */
export class CompartirUnidadDto {
  @IsInt({ message: 'Indique el operativo que compartirá la unidad.' })
  operativoId!: number;

  @IsInt({ message: 'Indique el operativo con cuya unidad compartirá.' })
  anfitrionOperativoId!: number;
}

export class FechaDto {
  @Matches(PATRON_FECHA, { message: 'La fecha se escribe como AAAA-MM-DD.' })
  fecha!: string;
}

export class ActivarConductorDto extends FechaDto {
  @IsInt({ message: 'Debe seleccionar un conductor.' })
  conductorId!: number;

  @MaxLength(220, { message: 'El motivo no supera los 220 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  @IsNotEmpty({ message: 'Indique el motivo de la activación.' })
  motivo!: string;
}

// ─────────────────────────── Traslados ───────────────────────────

export class ParTrasladoDto {
  @IsInt({ message: 'La zonal de origen debe ser un identificador.' })
  zonalOrigenId!: number;

  @IsInt({ message: 'La zonal de destino debe ser un identificador.' })
  zonalDestinoId!: number;

  /** `null` borra el par y lo devuelve a la regla general. */
  @ValidateIf((dto: ParTrasladoDto) => dto.minutos !== null)
  @Max(600, { message: 'Un traslado no supera los 600 minutos.' })
  @Min(0, { message: 'Los minutos no pueden ser negativos.' })
  @IsInt({ message: 'Los minutos deben ser un número entero.' })
  minutos!: number | null;
}

export class GuardarTrasladosDto {
  @IsArray({ message: 'Los traslados deben llegar como lista.' })
  @ArrayMaxSize(1000, { message: 'Como máximo 1000 pares por envío.' })
  @ValidateNested({ each: true })
  @Type(() => ParTrasladoDto)
  pares!: ParTrasladoDto[];
}

// ─────────────────────────── Turnos de conductores ───────────────────────────

export class CeldaTurnoConductorDto {
  @IsInt({ message: 'El conductor debe ser un identificador.' })
  conductorId!: number;

  @Matches(PATRON_FECHA, { message: 'La fecha se escribe como AAAA-MM-DD.' })
  fecha!: string;

  /** `null` LIMPIA la celda. */
  @ValidateIf((dto: CeldaTurnoConductorDto) => dto.turno !== null)
  @IsEnum(TurnoConductor, {
    message:
      'El turno solo puede ser DIA, NOCHE, ECU_NOCHE, LIBRE o ADMINISTRATIVO (o vacío para limpiar).',
  })
  turno!: TurnoConductor | null;
}

export class LoteTurnosConductoresDto {
  @IsArray({ message: 'Las celdas deben llegar como lista.' })
  @ArrayMaxSize(3000, { message: 'Como máximo 3000 celdas por lote.' })
  @ValidateNested({ each: true })
  @Type(() => CeldaTurnoConductorDto)
  celdas!: CeldaTurnoConductorDto[];
}

export class MesTurnosDto {
  @Matches(PATRON_MES, { message: 'El mes se escribe como AAAA-MM.' })
  mes!: string;
}

/** Cuerpo de `POST /transporte/turnos-conductores/propuesta-mes` (2026-10-07). */
export class PropuestaMesConductoresDto extends MesTurnosDto {
  @IsOptional()
  @IsBoolean({ message: 'rehacerTodo debe ser verdadero o falso.' })
  rehacerTodo?: boolean;
}

/** Query de `GET /transporte/turnos-conductores/exportar`: `formato` xlsx (por omisión) o pdf. */
export class ExportarTurnosDto extends MesTurnosDto {
  @IsOptional()
  @IsIn(['xlsx', 'pdf'], { message: 'El formato admite xlsx o pdf.' })
  formato?: 'xlsx' | 'pdf';
}

export class PropuestaRotacionConductoresDto extends MesTurnosDto {
  @IsOptional()
  @IsArray({ message: 'Los conductores deben llegar como lista.' })
  @ArrayMaxSize(500)
  @IsInt({ each: true, message: 'Cada conductor debe ser un identificador.' })
  conductorIds?: number[];
}

// ─────────────────────────── Optimizador «Cubrir al máximo» (Fase 3) ───────────────────────────

export class OptimizarDto extends FechaDto {
  /** Si puede proponer activar conductores LIBRES (horas extra). Por omisión, no. */
  @IsOptional()
  @IsBoolean({ message: 'activarLibres debe ser verdadero o falso.' })
  activarLibres?: boolean;

  /** Si puede proponer compartir carro entre operativos compatibles. Por omisión, sí. */
  @IsOptional()
  @IsBoolean({ message: 'compartirCarro debe ser verdadero o falso.' })
  compartirCarro?: boolean;

  /**
   * SIMULACIÓN (2026-10-08): compara «sin libres» y «con libres» en memoria, sobre los tramos que ya
   * existen, y devuelve la sugerencia de libres. No genera tramos ni escribe nada.
   */
  @IsOptional()
  @IsBoolean({ message: 'simular debe ser verdadero o falso.' })
  simular?: boolean;
}

export class AsignacionPropuestaDto {
  @IsArray({ message: 'Los tramos deben llegar como lista.' })
  @ArrayMinSize(1, { message: 'Cada asignación lleva al menos un tramo.' })
  @ArrayMaxSize(200)
  @IsInt({ each: true, message: 'Cada tramo debe ser un identificador.' })
  tramoIds!: number[];

  @IsInt({ message: 'Cada asignación lleva un conductor.' })
  conductorId!: number;

  @ValidateIf((dto: AsignacionPropuestaDto) => dto.vehiculoId !== null)
  @IsInt({ message: 'El vehículo propuesto no es válido.' })
  vehiculoId!: number | null;
}

export class ActivacionPropuestaDto {
  @IsInt({ message: 'Cada activación lleva un conductor.' })
  conductorId!: number;

  @MaxLength(220, { message: 'El motivo no supera los 220 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  motivo!: string;
}

export class CompartidoPropuestoDto {
  @IsInt({ message: 'El tramo que comparte debe ser un identificador.' })
  tramoId!: number;

  @IsInt({ message: 'El tramo anfitrión debe ser un identificador.' })
  compartidoConTramoId!: number;
}

export class ConfirmarOptimizacionDto extends FechaDto {
  @IsArray({ message: 'Las asignaciones deben llegar como lista.' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AsignacionPropuestaDto)
  asignaciones!: AsignacionPropuestaDto[];

  @IsOptional()
  @IsArray({ message: 'Las activaciones deben llegar como lista.' })
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ActivacionPropuestaDto)
  activaciones?: ActivacionPropuestaDto[];

  @IsOptional()
  @IsArray({ message: 'Los compartidos deben llegar como lista.' })
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CompartidoPropuestoDto)
  compartidos?: CompartidoPropuestoDto[];

  /**
   * La estrategia que ganó en la propuesta («por dificultad, sin activar libres»), tal como la
   * devolvió `POST /transporte/optimizar`. Solo para la traza (2026-10-14); no decide nada.
   */
  @IsOptional()
  @IsString({ message: 'La estrategia debe ser un texto.' })
  @MaxLength(120, {
    message: 'La estrategia no puede pasar de 120 caracteres.',
  })
  estrategia?: string;
}

export const OPCIONES_PRIORIZACION = [
  'PROPIOS_MEDIOS',
  'COMPARTIR',
  'LIBERAR_OTRO',
] as const;

export class PriorizacionDto {
  @IsInt({ message: 'Indique el operativo sin recurso.' })
  operativoId!: number;

  @IsOptional()
  @IsArray({ message: 'Las opciones deben llegar como lista.' })
  @ArrayMaxSize(3)
  @IsIn(OPCIONES_PRIORIZACION, {
    each: true,
    message: 'Cada opción debe ser PROPIOS_MEDIOS, COMPARTIR o LIBERAR_OTRO.',
  })
  opciones?: string[];

  @IsOptional()
  @MaxLength(200, { message: 'El motivo no supera los 200 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  motivo?: string;
}

/** Asigna la TAREA «Llevar a taller» a un conductor (el vehículo ya viene en la tarea). */
export class AsignarTareaDto {
  @IsInt({ message: 'Debe seleccionar un conductor.' })
  conductorId!: number;
}

// ─────────────────────────── Fin del día (puntos 17–18) ───────────────────────────

export class GuardaFinalDto {
  @IsInt({ message: 'Cada guarda lleva su vehículo.' })
  vehiculoId!: number;

  @IsEnum(TipoUbicacionVehiculo, {
    message: 'El tipo de guarda es GARAJE, DOMICILIO o TALLER.',
  })
  tipo!: TipoUbicacionVehiculo;

  /** Garaje o taller donde queda. No aplica a DOMICILIO. */
  @ValidateIf(
    (dto: GuardaFinalDto) => dto.tipo !== TipoUbicacionVehiculo.DOMICILIO,
  )
  @IsInt({ message: 'Indique dónde queda el vehículo.' })
  ubicacionId!: number | null;

  /** Quién se lo lleva (DOMICILIO): mañana se le repite el vehículo. */
  @IsOptional()
  @IsInt({ message: 'El conductor debe ser un identificador.' })
  conductorId?: number | null;

  @IsOptional()
  @MaxLength(200, { message: 'La observación no supera los 200 caracteres.' })
  @IsString({ message: 'La observación debe ser texto.' })
  observacion?: string | null;

  /**
   * N.º del acta de parqueadero (2026-10-08, Art. 8). OBLIGATORIO en DOMICILIO: sin él la petición
   * entera es 400. Que coincida con el acta vigente del conductor lo comprueba el servicio, por
   * vehículo (un número equivocado va en `errores` y no impide las demás guardas).
   */
  @ValidateIf(
    (dto: GuardaFinalDto) => dto.tipo === TipoUbicacionVehiculo.DOMICILIO,
  )
  @MaxLength(60, { message: 'El número de acta no supera los 60 caracteres.' })
  @IsNotEmpty({
    message:
      'Escriba el número del acta de parqueadero para dejar el vehículo en el domicilio.',
  })
  @IsString({ message: 'El número de acta debe ser texto.' })
  actaNumero?: string | null;
}

export class GuardarFinDelDiaDto {
  @IsArray({ message: 'Las guardas deben llegar como lista.' })
  @ArrayMinSize(1, { message: 'Indique al menos una guarda.' })
  @ArrayMaxSize(300)
  @ValidateNested({ each: true })
  @Type(() => GuardaFinalDto)
  guardas!: GuardaFinalDto[];
}

// ─────────────────────────── Operación diaria de la flota (Fase 5) ───────────────────────────

export class ChecklistDto extends FechaDto {
  @IsInt({ message: 'Indique el vehículo.' })
  vehiculoId!: number;

  @IsInt({ message: 'Indique el conductor.' })
  conductorId!: number;

  /** Rubro → conforme (p. ej. { "llantas": true, "luces": false }). */
  @IsObject({ message: 'Los rubros del checklist deben llegar como objeto.' })
  items!: Record<string, boolean>;

  @IsOptional()
  @MaxLength(400, { message: 'La observación no supera los 400 caracteres.' })
  @IsString({ message: 'La observación debe ser texto.' })
  observacion?: string | null;

  @IsOptional()
  @Max(9_999_999, { message: 'El kilometraje no es válido.' })
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  @IsInt({ message: 'El kilometraje debe ser un número entero.' })
  kilometrajeSalida?: number | null;
}

export class KilometrajeDto extends FechaDto {
  @IsInt({ message: 'Indique el vehículo.' })
  vehiculoId!: number;

  @IsOptional()
  @IsInt({ message: 'El conductor debe ser un identificador.' })
  conductorId?: number | null;

  @Max(9_999_999, { message: 'El kilometraje no es válido.' })
  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  @IsInt({ message: 'El kilometraje debe ser un número entero.' })
  kilometraje!: number;
}

export class ValeCombustibleDto extends FechaDto {
  @IsInt({ message: 'Indique el conductor.' })
  conductorId!: number;

  @IsInt({ message: 'Indique el vehículo.' })
  vehiculoId!: number;

  @IsIn([10, 20], {
    message: 'El vale de combustible solo puede ser de $10 o $20.',
  })
  @IsInt({ message: 'El monto debe ser un número entero.' })
  monto!: number;

  @IsOptional()
  @MaxLength(40, { message: 'El número del vale no supera los 40 caracteres.' })
  @IsString({ message: 'El número del vale debe ser texto.' })
  numero?: string | null;
}
