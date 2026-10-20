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
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EstadoMantenimiento,
  SectorCiudad,
  TipoContrato,
  TipoUbicacionVehiculo,
} from '@prisma/client';
import type {
  Conductor,
  Disponibilidad,
  EstadoTransporte,
  Vehiculo,
} from '@prisma/client';

import type {
  ConductorConVehiculo,
  DestinoConUbicacion,
  UbicacionConZonal,
} from '../../infrastructure/flota.repository';
import type { OperativoCompleto } from '../../../operativos/infrastructure/operativos.repository';
import {
  alertasDeVencimiento,
  estadoDocumentos,
  hoyEnGuayaquil,
  type AlertaVencimiento,
  type EstadoDocumentos,
} from '../../application/politicas/vencimiento-documentos';
import {
  esGarajeVigente,
  faltantesDeConductor,
  type FaltanteConductor,
} from '../../application/politicas/datos-flota';
import type {
  ConductorDisponible,
  VehiculoDeLaFlota,
} from '../../application/transporte.service';

/** `AAAA-MM-DD` de las fichas de flota (acta, matrícula, SOAT). */
const PATRON_FECHA_FLOTA = /^\d{4}-\d{2}-\d{2}$/;

/** D día · N noche · E ECU noche · L libre · A administrativo; de 2 a 14 días de ciclo. */
export const PATRON_ROTACION = /^[DNELA]{2,14}$/;

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
  /** Acta de parqueadero (Art. 8, 2026-10-06). Sin acta vigente no se declara DOMICILIO. */
  @MaxLength(40, { message: 'El número de acta no supera los 40 caracteres.' })
  @IsString({ message: 'El número de acta debe ser texto.' })
  @IsOptional()
  actaParqueaderoNumero?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'La vigencia del acta se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  actaParqueaderoDesde?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'La vigencia del acta se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  actaParqueaderoHasta?: string | null;

  /** Patrón de rotación (2026-10-07): D día, N noche, E ECU noche, L libre, A administrativo. */
  @Matches(PATRON_ROTACION, {
    message:
      'El patrón de rotación lleva de 2 a 14 letras: D (día), N (noche), E (ECU noche), L (libre) o A (administrativo).',
  })
  @IsOptional()
  patronRotacion?: string | null;
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
  /** Acta de parqueadero (Art. 8, 2026-10-06). Sin acta vigente no se declara DOMICILIO. */
  @MaxLength(40, { message: 'El número de acta no supera los 40 caracteres.' })
  @IsString({ message: 'El número de acta debe ser texto.' })
  @IsOptional()
  actaParqueaderoNumero?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'La vigencia del acta se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  actaParqueaderoDesde?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'La vigencia del acta se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  actaParqueaderoHasta?: string | null;

  /** Patrón de rotación (2026-10-07): D día, N noche, E ECU noche, L libre, A administrativo. */
  @Matches(PATRON_ROTACION, {
    message:
      'El patrón de rotación lleva de 2 a 14 letras: D (día), N (noche), E (ECU noche), L (libre) o A (administrativo).',
  })
  @IsOptional()
  patronRotacion?: string | null;
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
  /** Ficha del vehículo (2026-10-06). */
  @MaxLength(40, { message: 'El tipo no supera los 40 caracteres.' })
  @IsString({ message: 'El tipo debe ser texto.' })
  @IsOptional()
  tipo?: string | null;

  /** Plazas de PASAJEROS (sin contar al conductor). */
  @Max(60, { message: 'Los asientos no pueden superar 60.' })
  @Min(1, { message: 'Indique al menos un asiento.' })
  @IsInt({ message: 'Los asientos deben ser un número entero.' })
  @IsOptional()
  asientos?: number | null;

  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  @IsInt({ message: 'El kilometraje debe ser un número entero.' })
  @IsOptional()
  kilometraje?: number | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'El vencimiento de la matrícula se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  matriculaVencimiento?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'El vencimiento del SOAT se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  soatVencimiento?: string | null;
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
  /** Ficha del vehículo (2026-10-06). */
  @MaxLength(40, { message: 'El tipo no supera los 40 caracteres.' })
  @IsString({ message: 'El tipo debe ser texto.' })
  @IsOptional()
  tipo?: string | null;

  /** Plazas de PASAJEROS (sin contar al conductor). */
  @Max(60, { message: 'Los asientos no pueden superar 60.' })
  @Min(1, { message: 'Indique al menos un asiento.' })
  @IsInt({ message: 'Los asientos deben ser un número entero.' })
  @IsOptional()
  asientos?: number | null;

  @Min(0, { message: 'El kilometraje no puede ser negativo.' })
  @IsInt({ message: 'El kilometraje debe ser un número entero.' })
  @IsOptional()
  kilometraje?: number | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'El vencimiento de la matrícula se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  matriculaVencimiento?: string | null;

  @Matches(PATRON_FECHA_FLOTA, {
    message: 'El vencimiento del SOAT se escribe como AAAA-MM-DD.',
  })
  @IsOptional()
  soatVencimiento?: string | null;
}

// ─────────── Ubicaciones y destino del vehículo (RN-DAF-03) ───────────

export class CrearUbicacionDto {
  @MaxLength(120, { message: 'El nombre no supera los 120 caracteres.' })
  @IsNotEmpty({ message: 'Indique el nombre de la zonal.' })
  nombre: string;
  /**
   * Garaje autorizado por el Reglamento (Art. 8). SE IGNORA desde el 2026-10-14 (D2): todo garaje
   * nuevo nace autorizado. Se conserva para no rechazar a un cliente que todavía lo envía.
   */
  @IsBoolean({ message: 'Indique si es un garaje autorizado.' })
  @IsOptional()
  garajeAutorizado?: boolean;

  /** Zonal donde está, para medir el traslado al primer punto del día. */
  @IsInt({ message: 'La zonal seleccionada no es válida.' })
  @IsOptional()
  zonalId?: number | null;
}

export class ActualizarUbicacionDto {
  @MaxLength(120, { message: 'El nombre no supera los 120 caracteres.' })
  @IsOptional()
  nombre?: string;

  @IsBoolean({ message: 'Indique si la zonal sigue vigente.' })
  @IsOptional()
  activo?: boolean;
  /** Garaje autorizado por el Reglamento (Art. 8). */
  @IsBoolean({ message: 'Indique si es un garaje autorizado.' })
  @IsOptional()
  garajeAutorizado?: boolean;

  /** Zonal donde está, para medir el traslado al primer punto del día. */
  @IsInt({ message: 'La zonal seleccionada no es válida.' })
  @IsOptional()
  zonalId?: number | null;
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

  /**
   * GARAJE | DOMICILIO | TALLER (2026-10-06). Si no viaja: DOMICILIO cuando `domicilio`, si no
   * GARAJE. DOMICILIO exige `domicilio: true` y un conductor con acta de parqueadero vigente.
   */
  @IsEnum(TipoUbicacionVehiculo, {
    message: 'El tipo admite GARAJE, DOMICILIO o TALLER.',
  })
  @IsOptional()
  tipo?: TipoUbicacionVehiculo;

  /** Quién se lo lleva a casa (DOMICILIO). Si no viaja, el conductor habitual del vehículo. */
  @IsInt({ message: 'El conductor seleccionado no es válido.' })
  @IsOptional()
  conductorId?: number;
}

export interface UbicacionResponseDto {
  id: number;
  nombre: string;
  activo: boolean;
  garajeAutorizado: boolean;
  zonalId: number | null;
  /** El zonal asociado, con su nombre; `null` si no tiene (p. ej. el garaje «Matriz»). */
  zonal: { id: number; nombre: string } | null;
  /** Activo Y autorizado (D2, 2026-10-14): el único que se ofrece a la DAF. */
  vigente: boolean;
  /** ACTIVO o DE_BAJA (2026-10-20): se deriva de `activo`, no es otra columna. */
  estado: EstadoRegistroFlota;
  /** Cuándo y quién lo dio de baja (ISO y nombre); `null` si está activo o no consta. */
  bajaEn: string | null;
  bajaPorNombre: string | null;

  /**
   * «Vehículos que lo usan» (2026-10-14): la última fecha (AAAA-MM-DD) en que cada vehículo quedó
   * en este garaje, de la más reciente a la más antigua. Vacío si nunca se usó.
   */
  usos: { vehiculoId: number; placa: string; ultimaFecha: string }[];
}

/** El estado de un registro de la flota, derivado de `activo` (D1, 2026-10-20). */
export type EstadoRegistroFlota = 'ACTIVO' | 'DE_BAJA';

/** Quién y cuándo dio de baja, para la insignia «De baja» de la pantalla. */
type ConBaja = { bajaEn: Date | null; bajaPorNombre?: string | null };

function datosDeBaja(registro: { activo: boolean } & ConBaja) {
  return {
    estado: (registro.activo ? 'ACTIVO' : 'DE_BAJA') as EstadoRegistroFlota,
    bajaEn: registro.activo ? null : (registro.bajaEn?.toISOString() ?? null),
    bajaPorNombre: registro.activo ? null : (registro.bajaPorNombre ?? null),
  };
}

export interface DestinoResponseDto {
  vehiculoId: number;
  placa: string;
  fecha: string;
  ubicacion: { id: number; nombre: string } | null;
  domicilio: boolean;
  observacion: string | null;
  tipo: TipoUbicacionVehiculo | null;
}

export function aUbicacionResponse(
  ubicacion: UbicacionConZonal & { bajaPorNombre?: string | null },
  usos: readonly {
    vehiculoId: number;
    placa: string;
    ultimaFecha: Date;
  }[] = [],
): UbicacionResponseDto {
  return {
    vigente: esGarajeVigente(ubicacion),
    usos: usos.map((u) => ({
      vehiculoId: u.vehiculoId,
      placa: u.placa,
      ultimaFecha: u.ultimaFecha.toISOString().slice(0, 10),
    })),
    id: ubicacion.id,
    nombre: ubicacion.nombre,
    activo: ubicacion.activo,
    garajeAutorizado: ubicacion.garajeAutorizado,
    zonalId: ubicacion.zonalId,
    zonal: ubicacion.zonal
      ? { id: ubicacion.zonal.id, nombre: ubicacion.zonal.nombre }
      : null,
    ...datosDeBaja({
      activo: esGarajeVigente(ubicacion),
      bajaEn: ubicacion.bajaEn,
      bajaPorNombre: ubicacion.bajaPorNombre,
    }),
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
    tipo: destino.tipo,
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

  /** Zonal del taller (Fase 5): destino de la TAREA «Llevar a taller». */
  @IsInt({ message: 'La zonal del taller debe ser un identificador.' })
  @IsOptional()
  zonalTallerId?: number | null;
}

/** Cambio de estado de una cita de taller (Fase 5): PROGRAMADO → EN_TALLER → LISTO. */
export class CambiarEstadoMantenimientoDto {
  @IsEnum(EstadoMantenimiento, {
    message: 'El estado de la cita es PROGRAMADO, EN_TALLER o LISTO.',
  })
  estado!: EstadoMantenimiento;
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
  /** PROGRAMADO / EN_TALLER / LISTO (Fase 5). */
  estado: EstadoMantenimiento;
  zonalTallerId: number | null;
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
    estado: fila.estadoMantenimiento ?? EstadoMantenimiento.PROGRAMADO,
    zonalTallerId: fila.zonalTallerId,
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
  /** `descripcion` y `activo` del 2026-10-14 (Flota y garajes): la tabla los muestra. */
  vehiculoHabitual: {
    id: number;
    placa: string;
    descripcion: string | null;
    activo: boolean;
  } | null;
  activo: boolean;
  /** ACTIVO o DE_BAJA (2026-10-20): se deriva de `activo`, no es otra columna. */
  estado: EstadoRegistroFlota;
  /** Cuándo y quién lo dio de baja (ISO y nombre); `null` si está activo o no consta. */
  bajaEn: string | null;
  bajaPorNombre: string | null;
  /**
   * Lo que le falta para que la DAF lo planifique bien (2026-10-14): VEHICULO_HABITUAL (ninguno o
   * dado de baja), TIPO_CONTRATO, PATRON_ROTACION. Vacío = completo. Ver `politicas/datos-flota.ts`.
   */
  faltantes: FaltanteConductor[];
  /** Los tres del 2026-08-31. `null` significa «no consta», no un valor por defecto. */
  sector: SectorCiudad | null;
  parqueaderoAutorizado: boolean;
  tipoContrato: TipoContrato | null;
  actaParqueaderoNumero: string | null;
  actaParqueaderoDesde: string | null;
  actaParqueaderoHasta: string | null;
  /** Patrón de rotación (D/N/E/L/A, 2 a 14 letras) o null. */
  patronRotacion: string | null;
}

export interface VehiculoResponseDto {
  id: number;
  placa: string;
  descripcion: string | null;
  activo: boolean;
  /** ACTIVO o DE_BAJA (2026-10-20): se deriva de `activo`, no es otra columna. */
  estado: EstadoRegistroFlota;
  /** Cuándo y quién lo dio de baja (ISO y nombre); `null` si está activo o no consta. */
  bajaEn: string | null;
  bajaPorNombre: string | null;
  tipo: string | null;
  asientos: number | null;
  kilometraje: number | null;
  matriculaVencimiento: string | null;
  soatVencimiento: string | null;
  /** SOAT y matrícula vencidos o por vencer (DAF_DIAS_AVISO_VENCIMIENTO), con el día de Quito. */
  alertasVencimiento: AlertaVencimiento[];
  /** El estado más crítico de matrícula y SOAT, para la insignia de la tabla (2026-10-14). */
  documentos: EstadoDocumentos;
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
  conductor: ConductorConVehiculo & { bajaPorNombre?: string | null },
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
          descripcion: conductor.vehiculoHabitual.descripcion,
          activo: conductor.vehiculoHabitual.activo,
        }
      : null,
    activo: conductor.activo,
    ...datosDeBaja(conductor),
    faltantes: faltantesDeConductor(conductor),
    sector: conductor.sector,
    parqueaderoAutorizado: conductor.parqueaderoAutorizado,
    tipoContrato: conductor.tipoContrato,
    actaParqueaderoNumero: conductor.actaParqueaderoNumero,
    actaParqueaderoDesde: diaONulo(conductor.actaParqueaderoDesde),
    actaParqueaderoHasta: diaONulo(conductor.actaParqueaderoHasta),
    patronRotacion: conductor.patronRotacion,
  };
}

export function aVehiculoResponse(
  vehiculo: Vehiculo & { bajaPorNombre?: string | null },
  diasAvisoVencimiento: number,
  hoy: string = hoyEnGuayaquil(),
): VehiculoResponseDto {
  return {
    id: vehiculo.id,
    placa: vehiculo.placa,
    descripcion: vehiculo.descripcion,
    activo: vehiculo.activo,
    ...datosDeBaja(vehiculo),
    tipo: vehiculo.tipo,
    asientos: vehiculo.asientos,
    kilometraje: vehiculo.kilometraje,
    matriculaVencimiento: diaONulo(vehiculo.matriculaVencimiento),
    soatVencimiento: diaONulo(vehiculo.soatVencimiento),
    alertasVencimiento: alertasDeVencimiento(
      vehiculo,
      hoy,
      diasAvisoVencimiento,
    ),
    documentos: estadoDocumentos(
      vehiculo.matriculaVencimiento,
      vehiculo.soatVencimiento,
      hoy,
      diasAvisoVencimiento,
    ),
  };
}

function diaONulo(fecha: Date | null): string | null {
  return fecha ? fecha.toISOString().slice(0, 10) : null;
}

/** «AAAA-MM-DD» → Date UTC; `null` (o vacío) limpia y `undefined` deja como está. */
export function aFechaFlota(
  texto: string | null | undefined,
): Date | null | undefined {
  if (texto === undefined) return undefined;
  if (texto === null || texto === '') return null;
  return new Date(`${texto}T00:00:00.000Z`);
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
