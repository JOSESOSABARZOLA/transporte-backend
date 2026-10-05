/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: transporte.dto.ts
 * Responsabilidad: Declarar el contrato de la asignación logística.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * `ActualizarTransporteDto` ES EL DTO MÁS SENSIBLE DEL SISTEMA.
 *
 * **EXACTAMENTE DOS PROPIEDADES. NO SE LE AGREGA NINGUNA BAJO NINGUNA CIRCUNSTANCIA.**
 *
 * Es la garantía escrita de que la DAF no toca el resto del operativo: con
 * `forbidNonWhitelisted`, cualquier campo adicional produce `400 CAMPOS_NO_PERMITIDOS`
 * con la lista de rechazados. Es la regla 3 de CLAUDE.md y el segundo de los cuatro
 * niveles de la restricción.
 *
 * Si alguna vez hiciera falta que la DAF escribiera otra cosa, **no se amplía este DTO**:
 * se discute con el Product Owner si esa competencia le corresponde, y si le corresponde
 * se le da su propio endpoint con su propio contrato.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { SectorCiudad, TipoContrato } from '@prisma/client';
import type {
  Conductor,
  Disponibilidad,
  EstadoTransporte,
  UbicacionFlota,
  Vehiculo,
} from '@prisma/client';

import type {
  ConductorConVehiculo,
  DestinoConUbicacion,
} from '../../infrastructure/flota.repository';
import type { OperativoCompleto } from '../../../operativos/infrastructure/operativos.repository';
import type {
  ConductorDisponible,
  VehiculoDeLaFlota,
} from '../../application/transporte.service';

export class ActualizarTransporteDto {
  @IsInt({ message: 'Debe seleccionar un conductor.' })
  conductorId: number;

  @IsInt({ message: 'Debe seleccionar un vehículo.' })
  vehiculoId: number;
}

// ─────────────────── Administración de la flota ───────────────────

export class CrearConductorDto {
  @MaxLength(13, { message: 'La cédula no puede superar los 13 caracteres.' })
  @IsNotEmpty({ message: 'Indique la cédula del conductor.' })
  cedula: string;

  @MaxLength(160, {
    message: 'El nombre no puede superar los 160 caracteres.',
  })
  @IsNotEmpty({ message: 'Indique el nombre completo del conductor.' })
  nombreCompleto: string;

  @MaxLength(20, { message: 'El teléfono no puede superar los 20 caracteres.' })
  @IsOptional()
  telefono?: string;

  @MaxLength(10, {
    message: 'El tipo de licencia no puede superar los 10 caracteres.',
  })
  @IsOptional()
  licenciaTipo?: string;

  @IsInt({ message: 'El vehículo habitual seleccionado no es válido.' })
  @IsOptional()
  vehiculoHabitualId?: number;

  @IsEnum(SectorCiudad, {
    message: 'El sector admite estos valores: NORTE, SUR, CENTRO, VALLE.',
  })
  @IsOptional()
  sector?: SectorCiudad;

  @IsBoolean({ message: 'Indique si tiene parqueadero autorizado.' })
  @IsOptional()
  parqueaderoAutorizado?: boolean;

  @IsEnum(TipoContrato, {
    message: 'El tipo de contrato no es válido.',
  })
  @IsOptional()
  tipoContrato?: TipoContrato;
}

export class ActualizarConductorDto {
  @MaxLength(160, {
    message: 'El nombre no puede superar los 160 caracteres.',
  })
  @IsOptional()
  nombreCompleto?: string;

  @MaxLength(20, { message: 'El teléfono no puede superar los 20 caracteres.' })
  @IsOptional()
  telefono?: string;

  @MaxLength(10, {
    message: 'El tipo de licencia no puede superar los 10 caracteres.',
  })
  @IsOptional()
  licenciaTipo?: string;

  @IsInt({ message: 'El vehículo habitual seleccionado no es válido.' })
  @IsOptional()
  vehiculoHabitualId?: number;

  @IsEnum(SectorCiudad, {
    message: 'El sector admite estos valores: NORTE, SUR, CENTRO, VALLE.',
  })
  @IsOptional()
  sector?: SectorCiudad;

  @IsBoolean({ message: 'Indique si tiene parqueadero autorizado.' })
  @IsOptional()
  parqueaderoAutorizado?: boolean;

  @IsEnum(TipoContrato, { message: 'El tipo de contrato no es válido.' })
  @IsOptional()
  tipoContrato?: TipoContrato;
}

export class CrearVehiculoDto {
  @MaxLength(10, { message: 'La placa no puede superar los 10 caracteres.' })
  @IsNotEmpty({ message: 'Indique la placa del vehículo.' })
  placa: string;

  @MaxLength(160, {
    message: 'La descripción no puede superar los 160 caracteres.',
  })
  @IsOptional()
  descripcion?: string;
}

export class ActualizarVehiculoDto {
  @MaxLength(10, { message: 'La placa no puede superar los 10 caracteres.' })
  @IsOptional()
  placa?: string;

  @MaxLength(160, {
    message: 'La descripción no puede superar los 160 caracteres.',
  })
  @IsOptional()
  descripcion?: string;
}

// ─────────── Ubicaciones y destino del vehículo (RN-DAF-03) ───────────

export class CrearUbicacionDto {
  @MaxLength(120, { message: 'El nombre no supera los 120 caracteres.' })
  @IsNotEmpty({ message: 'Indique el nombre de la zonal.' })
  nombre: string;
}

export class ActualizarUbicacionDto {
  @MaxLength(120, { message: 'El nombre no supera los 120 caracteres.' })
  @IsOptional()
  nombre?: string;

  @IsBoolean({ message: 'Indique si la zonal sigue vigente.' })
  @IsOptional()
  activo?: boolean;
}

/**
 * Cuerpo de `PUT /transporte/vehiculos/:id/destino/:fecha`.
 *
 * Los dos primeros campos son EXCLUYENTES: o queda en una zonal, o se lo lleva el
 * conductor. El servicio lo comprueba y `ck_destino_sujeto` lo respalda en la base.
 */
export class DeclararDestinoDto {
  @IsInt({ message: 'La zonal seleccionada no es válida.' })
  @IsOptional()
  ubicacionId?: number | null;

  @IsBoolean({ message: 'Indique si se lo lleva el conductor.' })
  @IsOptional()
  domicilio?: boolean;

  @MaxLength(220, { message: 'La observación no supera los 220 caracteres.' })
  @IsString({ message: 'La observación debe ser texto.' })
  @IsOptional()
  observacion?: string | null;
}

export interface UbicacionResponseDto {
  id: number;
  nombre: string;
  activo: boolean;
}

export interface DestinoResponseDto {
  vehiculoId: number;
  placa: string;
  fecha: string;
  ubicacion: { id: number; nombre: string } | null;
  domicilio: boolean;
  observacion: string | null;
}

export function aUbicacionResponse(
  ubicacion: UbicacionFlota,
): UbicacionResponseDto {
  return {
    id: ubicacion.id,
    nombre: ubicacion.nombre,
    activo: ubicacion.activo,
  };
}

export function aDestinoResponse(
  destino: DestinoConUbicacion,
): DestinoResponseDto {
  return {
    vehiculoId: destino.vehiculoId,
    placa: destino.vehiculo.placa,
    fecha: destino.fecha.toISOString().slice(0, 10),
    ubicacion: destino.ubicacion
      ? { id: destino.ubicacion.id, nombre: destino.ubicacion.nombre }
      : null,
    domicilio: destino.domicilio,
    observacion: destino.observacion,
  };
}

// ─────────────────── Mantenimiento del vehículo (RN-DAF-05) ───────────────────

/** `AAAA-MM-DD`. Mismo criterio que el resto del módulo: la fecha viaja como texto. */
const PATRON_FECHA_MANTENIMIENTO = /^\d{4}-\d{2}-\d{2}$/;

export class CrearMantenimientoDto {
  @Matches(PATRON_FECHA_MANTENIMIENTO, {
    message: 'La fecha de inicio se escribe como AAAA-MM-DD.',
  })
  @IsNotEmpty({ message: 'Indique desde qué día está parado el vehículo.' })
  desde: string;

  @Matches(PATRON_FECHA_MANTENIMIENTO, {
    message: 'La fecha de fin se escribe como AAAA-MM-DD.',
  })
  @IsNotEmpty({ message: 'Indique hasta qué día está parado el vehículo.' })
  hasta: string;

  @MaxLength(120, { message: 'El taller no supera los 120 caracteres.' })
  @IsString({ message: 'El taller debe ser texto.' })
  @IsOptional()
  taller?: string | null;

  /**
   * Hora de la cita, `HH:MM`. Es el `08H00` de «CITA AMBACAR 08H00».
   *
   * Admite cualquier minuto, al revés que el horario de un operativo: `PATRON_HORA` de
   * RN-07 solo acepta en punto y media porque así se planifican los operativos, y un
   * taller cita a las 08H15 sin pedirle permiso a nadie.
   */
  @Matches(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'La hora de la cita se escribe como HH:MM.',
  })
  @IsOptional()
  hora?: string | null;

  @MaxLength(220, { message: 'El motivo no supera los 220 caracteres.' })
  @IsString({ message: 'El motivo debe ser texto.' })
  @IsOptional()
  motivo?: string | null;
}

/**
 * Una parada de taller, tal como la ve la DAF.
 *
 * **El motivo SÍ se devuelve**, al contrario que en las ausencias del personal. Allí
 * `disp_motivo` puede decir «cirugía programada» y es un dato de salud; aquí dice «cambio
 * de frenos» y es justamente lo que permite estimar cuándo vuelve el vehículo.
 */
export interface MantenimientoResponseDto {
  id: number;
  vehiculoId: number;
  desde: string;
  hasta: string;
  taller: string | null;
  hora: string | null;
  motivo: string | null;
}

export function aMantenimientoResponse(
  fila: Disponibilidad,
): MantenimientoResponseDto {
  return {
    id: fila.id,
    vehiculoId: fila.vehiculoId ?? 0,
    desde: fila.desde.toISOString().slice(0, 10),
    hasta: fila.hasta.toISOString().slice(0, 10),
    taller: fila.taller,
    hora: fila.hora,
    motivo: fila.motivo,
  };
}

// ─────────────────────────── Respuesta ───────────────────────────

/**
 * Lo que la DAF necesita ver de cada operativo pendiente.
 *
 * **Sin el personal asignado.** La pantalla de transporte resuelve conductor y vehículo;
 * quién sale en el operativo es competencia del departamento que lo cargó, y mostrarlo
 * aquí ampliaría el alcance de una pantalla cuya razón de ser es estar acotada. Lo que sí
 * lleva es **cuántas personas** van, porque de eso depende el tamaño del vehículo.
 */
export interface PendienteResponseDto {
  id: number;
  identificador: string;
  formularioNombre: string;
  formularioCodigo: string;
  colorFondo: string;
  horario: string;
  esNocturno: boolean;
  /** RN-43. Si es nocturno y lleva condicionante, el conductor es obligatorio. */
  requiereConductor: boolean;
  personasAsignadas: number;
  puntoEncuentro: string;
  zonales: string[];
  estadoTransporte: EstadoTransporte;
}

export interface TransporteResponseDto {
  id: number;
  identificador: string;
  estadoTransporte: EstadoTransporte;
  conductor: { id: number; nombreCompleto: string } | null;
  vehiculo: { id: number; placa: string } | null;
  asignadoEn: string | null;
  alertaActiva: boolean;
}

export interface ConductorResponseDto {
  id: number;
  cedula: string;
  nombreCompleto: string;
  telefono: string | null;
  licenciaTipo: string | null;
  vehiculoHabitual: { id: number; placa: string } | null;
  activo: boolean;
  /** Los tres del 2026-08-31. `null` significa «no consta», no un valor por defecto. */
  sector: SectorCiudad | null;
  parqueaderoAutorizado: boolean;
  tipoContrato: TipoContrato | null;
}

export interface VehiculoResponseDto {
  id: number;
  placa: string;
  descripcion: string | null;
  activo: boolean;
}

export function aPendienteResponse(
  operativo: OperativoCompleto,
): PendienteResponseDto {
  return {
    id: operativo.id,
    identificador: operativo.identificador,
    formularioNombre: operativo.formulario.nombre,
    formularioCodigo: operativo.formulario.codigo,
    colorFondo: operativo.formulario.colorFondo,
    horario: `${operativo.horaInicio.replace(':', 'H')} A ${operativo.horaFin.replace(':', 'H')}`,
    esNocturno: operativo.esNocturno,
    requiereConductor:
      operativo.formulario.condicionanteNoct && operativo.esNocturno,
    personasAsignadas: operativo.personal.length,
    puntoEncuentro:
      operativo.puntoEncuentro?.nombre ?? operativo.puntoLibre ?? '',
    zonales: operativo.zonales.map((fila) => fila.zonal.nombre),
    estadoTransporte: operativo.estadoTransporte,
  };
}

export function aTransporteResponse(
  operativo: OperativoCompleto,
  conductor: Conductor | null,
  vehiculo: Vehiculo | null,
): TransporteResponseDto {
  return {
    id: operativo.id,
    identificador: operativo.identificador,
    estadoTransporte: operativo.estadoTransporte,
    conductor: conductor
      ? { id: conductor.id, nombreCompleto: conductor.nombreCompleto }
      : null,
    vehiculo: vehiculo ? { id: vehiculo.id, placa: vehiculo.placa } : null,
    asignadoEn: operativo.asignadoEn
      ? operativo.asignadoEn.toISOString()
      : null,
    alertaActiva: operativo.alertaActiva,
  };
}

export function aConductorResponse(
  conductor: ConductorConVehiculo,
): ConductorResponseDto {
  return {
    id: conductor.id,
    cedula: conductor.cedula,
    nombreCompleto: conductor.nombreCompleto,
    telefono: conductor.telefono,
    licenciaTipo: conductor.licenciaTipo,
    vehiculoHabitual: conductor.vehiculoHabitual
      ? {
          id: conductor.vehiculoHabitual.id,
          placa: conductor.vehiculoHabitual.placa,
        }
      : null,
    activo: conductor.activo,
    sector: conductor.sector,
    parqueaderoAutorizado: conductor.parqueaderoAutorizado,
    tipoContrato: conductor.tipoContrato,
  };
}

export function aVehiculoResponse(vehiculo: Vehiculo): VehiculoResponseDto {
  return {
    id: vehiculo.id,
    placa: vehiculo.placa,
    descripcion: vehiculo.descripcion,
    activo: vehiculo.activo,
  };
}

/** El desplegable de la DAF: RN-45 ya lo entrega filtrado. */
export type ConductorDisponibleDto = ConductorDisponible;

/**
 * PV-33. La flota completa, con lo que impide usar cada placa.
 *
 * A diferencia del desplegable de conductores, éste **no viene filtrado**: las placas no
 * utilizables llegan con `utilizable: false` y su motivo, para mostrarlas inhabilitadas.
 */
export type VehiculoDeLaFlotaDto = VehiculoDeLaFlota;
