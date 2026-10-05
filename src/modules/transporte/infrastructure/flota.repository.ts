/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de transporte
 * Archivo: flota.repository.ts
 * Responsabilidad: Leer y administrar el catálogo de conductores y vehículos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * UN SOLO REPOSITORIO PARA LAS DOS TABLAS, y no dos como sugiere el plan. `t_conductor`
 * y `t_vehiculo` no se consultan por separado casi nunca: el conductor viaja con su
 * vehículo habitual —de ahí sale la placa que se propone (caso 9)— y la administración
 * de la flota los mantiene juntos. Partirlo obligaría a que el servicio compusiera esa
 * relación a mano en cada consulta.
 *
 * LEE `t_disponibilidad` PARA LOS DOS. Es la misma tabla que usa el personal, con la
 * referencia puesta en `cond_id` o en `vehi_id`. RN-45 excluye del desplegable a quien
 * está ausente, y `MANTENIMIENTO` existe en el enumerado exactamente para el vehículo.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoDisponibilidad,
  type Conductor,
  type DestinoVehiculo,
  type Disponibilidad,
  type Prisma,
  type SectorCiudad,
  type TipoContrato,
  type UbicacionFlota,
  type Vehiculo,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Conductor con el vehículo que conduce habitualmente. Caso 9 del plan. */
export type ConductorConVehiculo = Prisma.ConductorGetPayload<{
  include: { vehiculoHabitual: true };
}>;

export interface DatosConductor {
  cedula: string;
  nombreCompleto: string;
  telefono?: string | null;
  licenciaTipo?: string | null;
  vehiculoHabitualId?: number | null;
  /** Los tres del 2026-08-31. Opcionales: la flota se carga a mano y se completa despues. */
  sector?: SectorCiudad | null;
  parqueaderoAutorizado?: boolean;
  tipoContrato?: TipoContrato | null;
}

export interface CambiosConductor {
  nombreCompleto?: string;
  telefono?: string | null;
  licenciaTipo?: string | null;
  vehiculoHabitualId?: number | null;
  activo?: boolean;
  sector?: SectorCiudad | null;
  parqueaderoAutorizado?: boolean;
  tipoContrato?: TipoContrato | null;
}

export interface DatosVehiculo {
  placa: string;
  descripcion?: string | null;
}

/** Destino con su ubicación y su vehículo resueltos. RN-DAF-03. */
export type DestinoConUbicacion = Prisma.DestinoVehiculoGetPayload<{
  include: { ubicacion: true; vehiculo: true };
}>;

/**
 * Un destino que se va a declarar.
 *
 * `ubicacionId` y `domicilio` son EXCLUYENTES, y lo garantiza `ck_destino_sujeto` en la
 * base: o queda en una zonal, o se lo lleva el conductor. Nunca las dos, nunca ninguna.
 */
export interface NuevoDestino {
  vehiculoId: number;
  fecha: Date;
  ubicacionId: number | null;
  domicilio: boolean;
  observacion?: string | null;
  registradoPor: number;
}

/** Una parada de taller que se va a registrar. RN-DAF-05. */
export interface NuevoMantenimiento {
  vehiculoId: number;
  desde: Date;
  hasta: Date;
  taller?: string | null;
  hora?: string | null;
  motivo?: string | null;
  registradoPor: number;
}

/** Un operativo que un conductor ya tiene ese día. Alimenta el tablero P-14. */
export interface ConduccionDeLaJornada {
  conductorId: number;
  identificador: string;
  horaInicio: string;
  horaFin: string;
  horas: number;
  esNocturno: boolean;
  placa: string | null;
  punto: string;
}

/** Operativo que ya ocupa un vehículo en una fecha. RN-DAF-01. */
export interface AsignacionDeVehiculo {
  identificador: string;
  horaInicio: string;
  horaFin: string;
}

export interface CambiosVehiculo {
  placa?: string;
  descripcion?: string | null;
  activo?: boolean;
}

@Injectable()
export class FlotaRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Conductores ───────────────────────────

  async listarConductores(soloActivos = true): Promise<ConductorConVehiculo[]> {
    return this.prisma.conductor.findMany({
      where: soloActivos ? { activo: true } : {},
      include: { vehiculoHabitual: true },
      orderBy: { nombreCompleto: 'asc' },
    });
  }

  async buscarConductor(id: number): Promise<ConductorConVehiculo | null> {
    return this.prisma.conductor.findUnique({
      where: { id },
      include: { vehiculoHabitual: true },
    });
  }

  async buscarConductorPorCedula(cedula: string): Promise<Conductor | null> {
    return this.prisma.conductor.findUnique({ where: { cedula } });
  }

  async crearConductor(
    datos: DatosConductor,
    cliente: Prisma.TransactionClient,
  ): Promise<Conductor> {
    return cliente.conductor.create({ data: datos });
  }

  async actualizarConductor(
    id: number,
    cambios: CambiosConductor,
    cliente: Prisma.TransactionClient,
  ): Promise<Conductor> {
    return cliente.conductor.update({ where: { id }, data: cambios });
  }

  // ─────────────────────────── Vehículos ───────────────────────────

  async listarVehiculos(soloActivos = true): Promise<Vehiculo[]> {
    return this.prisma.vehiculo.findMany({
      where: soloActivos ? { activo: true } : {},
      orderBy: { placa: 'asc' },
    });
  }

  async buscarVehiculo(id: number): Promise<Vehiculo | null> {
    return this.prisma.vehiculo.findUnique({ where: { id } });
  }

  async buscarVehiculoPorPlaca(placa: string): Promise<Vehiculo | null> {
    return this.prisma.vehiculo.findUnique({ where: { placa } });
  }

  async crearVehiculo(
    datos: DatosVehiculo,
    cliente: Prisma.TransactionClient,
  ): Promise<Vehiculo> {
    return cliente.vehiculo.create({ data: datos });
  }

  async actualizarVehiculo(
    id: number,
    cambios: CambiosVehiculo,
    cliente: Prisma.TransactionClient,
  ): Promise<Vehiculo> {
    return cliente.vehiculo.update({ where: { id }, data: cambios });
  }

  // ─────────────────────────── Disponibilidad ───────────────────────────

  /**
   * RN-45. Identificadores de los conductores ausentes en la fecha.
   *
   * Se devuelve el conjunto de los EXCLUIDOS y no el de los disponibles: la lista
   * completa ya la tiene quien pregunta, y así una consulta sirve para filtrar cualquier
   * grupo sin repetir la comparación.
   */
  async conductoresAusentes(fecha: Date): Promise<Set<number>> {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        conductorId: { not: null },
        desde: { lte: fecha },
        hasta: { gte: fecha },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
      },
      select: { conductorId: true },
    });

    return new Set(
      filas
        .map((fila) => fila.conductorId)
        .filter((id): id is number => id !== null),
    );
  }

  /**
   * PV-33. Ausencias de TODA la flota en una fecha, en una sola consulta.
   *
   * Existe junto a `ausenciaDeVehiculo` y no en su lugar: aquélla responde por una placa
   * concreta en el camino de la asignación, y ésta arma el desplegable completo. Pedir la
   * de uno en uno para veinticinco vehículos serían veinticinco viajes a la base cada vez
   * que la DAF abre la pantalla.
   *
   * Devuelve un mapa y no un conjunto —al revés que `conductoresAusentes`— porque aquí sí
   * hace falta el MOTIVO: la placa no desaparece del desplegable, se muestra inhabilitada
   * y con su razón en palabras. Ver el comentario de `vehiculosDeLaFlota`.
   */
  async ausenciasDeVehiculos(
    fecha: Date,
  ): Promise<
    Map<
      number,
      { estado: EstadoDisponibilidad; hasta: Date; taller: string | null }
    >
  > {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        vehiculoId: { not: null },
        desde: { lte: fecha },
        hasta: { gte: fecha },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
      },
      select: { vehiculoId: true, estado: true, hasta: true, taller: true },
      // Con dos ausencias solapadas gana la que termina más tarde, que es la que de
      // verdad impide usar el vehículo.
      orderBy: { hasta: 'asc' },
    });

    const porVehiculo = new Map<
      number,
      { estado: EstadoDisponibilidad; hasta: Date; taller: string | null }
    >();

    for (const fila of filas) {
      if (fila.vehiculoId === null) continue;
      porVehiculo.set(fila.vehiculoId, {
        estado: fila.estado,
        hasta: fila.hasta,
        taller: fila.taller,
      });
    }

    return porVehiculo;
  }

  /** Ausencia del vehículo en la fecha. `MANTENIMIENTO` es la suya. */
  async ausenciaDeVehiculo(
    vehiculoId: number,
    fecha: Date,
  ): Promise<{ estado: EstadoDisponibilidad; hasta: Date } | null> {
    return this.prisma.disponibilidad.findFirst({
      where: {
        vehiculoId,
        desde: { lte: fecha },
        hasta: { gte: fecha },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
      },
      select: { estado: true, hasta: true },
      orderBy: { hasta: 'desc' },
    });
  }

  /**
   * RN-DAF-01. Operativos a los que el vehículo ya está asignado esa fecha.
   *
   * Espejo de `conduccionesDelDia` del conductor, y cada detalle lo es por el mismo
   * motivo que allí:
   *
   *   · `activo: true` — un operativo retirado salió del cuadro y no ocupa la placa.
   *   · `excluirOperativoId` — al reasignar, un operativo no se cruza consigo mismo.
   *     Sin excluirlo, cambiar de conductor conservando el vehículo se rechazaría solo,
   *     y ese es justamente el camino que la DAF necesita para corregir un error.
   *
   * NO SE DEVUELVE LA DURACIÓN, y es la única diferencia con la consulta del conductor:
   * un vehículo no acumula jornada ni tiene tope de horas. Lo único que se le pregunta es
   * si ya está ocupado.
   */
  async asignacionesDelVehiculoEn(
    vehiculoId: number,
    fecha: Date,
    excluirOperativoId?: number,
  ): Promise<AsignacionDeVehiculo[]> {
    return this.prisma.operativo.findMany({
      where: {
        vehiculoId,
        activo: true,
        cuadro: { fecha },
        id: excluirOperativoId ? { not: excluirOperativoId } : undefined,
      },
      select: { identificador: true, horaInicio: true, horaFin: true },
      orderBy: { horaInicio: 'asc' },
    });
  }

  // ─────────────── Ubicaciones y destino del vehículo · RN-DAF-03 ───────────────

  async listarUbicaciones(soloActivas = true): Promise<UbicacionFlota[]> {
    return this.prisma.ubicacionFlota.findMany({
      where: soloActivas ? { activo: true } : {},
      orderBy: { nombre: 'asc' },
    });
  }

  async buscarUbicacion(id: number): Promise<UbicacionFlota | null> {
    return this.prisma.ubicacionFlota.findUnique({ where: { id } });
  }

  async buscarUbicacionPorNombre(
    nombre: string,
  ): Promise<UbicacionFlota | null> {
    return this.prisma.ubicacionFlota.findUnique({ where: { nombre } });
  }

  async crearUbicacion(
    nombre: string,
    cliente: Prisma.TransactionClient,
  ): Promise<UbicacionFlota> {
    return cliente.ubicacionFlota.create({ data: { nombre } });
  }

  async actualizarUbicacion(
    id: number,
    cambios: { nombre?: string; activo?: boolean },
    cliente: Prisma.TransactionClient,
  ): Promise<UbicacionFlota> {
    return cliente.ubicacionFlota.update({ where: { id }, data: cambios });
  }

  /** Los destinos declarados de una fecha, con su ubicación resuelta. */
  async destinosDeLaFecha(fecha: Date): Promise<DestinoConUbicacion[]> {
    return this.prisma.destinoVehiculo.findMany({
      where: { fecha },
      include: { ubicacion: true, vehiculo: true },
      orderBy: { vehiculo: { placa: 'asc' } },
    });
  }

  /**
   * Declara el destino de un vehículo en una fecha. Idempotente por construcción.
   *
   * Es un `upsert` sobre `uq_destino_vehi_fecha`: declarar dos veces deja el mismo
   * resultado, y CORREGIR es volver a declarar. Con un `create` a secas, cambiar de
   * opinión exigiría borrar antes, y entre el borrado y el alta la pregunta «dónde duerme
   * hoy la 7056» no tendría respuesta.
   */
  async declararDestino(
    datos: NuevoDestino,
    cliente: Prisma.TransactionClient,
  ): Promise<DestinoVehiculo> {
    const { vehiculoId, fecha, ...resto } = datos;

    return cliente.destinoVehiculo.upsert({
      where: { vehiculoId_fecha: { vehiculoId, fecha } },
      update: resto,
      create: { vehiculoId, fecha, ...resto },
    });
  }

  async buscarDestino(
    vehiculoId: number,
    fecha: Date,
  ): Promise<DestinoVehiculo | null> {
    return this.prisma.destinoVehiculo.findUnique({
      where: { vehiculoId_fecha: { vehiculoId, fecha } },
    });
  }

  // ─────────────────────── Mantenimiento del vehículo ───────────────────────

  /** RN-DAF-05. Las paradas registradas de un vehículo, de la más reciente hacia atrás. */
  async listarMantenimientos(vehiculoId: number): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: { vehiculoId, estado: EstadoDisponibilidad.MANTENIMIENTO },
      orderBy: { desde: 'desc' },
    });
  }

  /**
   * Paradas del mismo vehículo que se cruzan con el rango dado.
   *
   * LA COMPARACIÓN LA HACE LA BASE, no un ayudante en TypeScript. Dos rangos de fechas se
   * cruzan si cada uno empieza antes de que el otro termine, y esa condición cabe en el
   * `where`: escribirla aquí evita traerse todas las filas para descartarlas en memoria, y
   * evita una segunda versión de una comparación que ya vive en `ausenciaDeVehiculo`.
   *
   * `excluirId` sirve al editar: un período no se solapa consigo mismo.
   */
  async mantenimientosQueSolapan(
    vehiculoId: number,
    desde: Date,
    hasta: Date,
    excluirId?: number,
  ): Promise<Disponibilidad[]> {
    return this.prisma.disponibilidad.findMany({
      where: {
        vehiculoId,
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        desde: { lte: hasta },
        hasta: { gte: desde },
        id: excluirId ? { not: excluirId } : undefined,
      },
      orderBy: { desde: 'asc' },
    });
  }

  async buscarMantenimiento(id: number): Promise<Disponibilidad | null> {
    return this.prisma.disponibilidad.findFirst({
      where: { id, estado: EstadoDisponibilidad.MANTENIMIENTO },
    });
  }

  async crearMantenimiento(
    datos: NuevoMantenimiento,
    cliente: Prisma.TransactionClient,
  ): Promise<Disponibilidad> {
    return cliente.disponibilidad.create({
      data: { ...datos, estado: EstadoDisponibilidad.MANTENIMIENTO },
    });
  }

  async eliminarMantenimiento(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.disponibilidad.delete({ where: { id } });
  }

  /**
   * P-14. Los operativos que cada conductor ya tiene ese día, en orden.
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * UNA SOLA CONSULTA PARA TODA LA JORNADA, no una por conductor.
   *
   * El tablero pinta treinta y cuatro conductores; pedir sus operativos de uno en uno
   * serían treinta y cuatro viajes cada vez que la DAF cambia de fecha. Se traen todos los
   * operativos del día que tienen conductor y el servicio los agrupa en memoria.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * `activo: true` por lo mismo que en el resto: un operativo retirado salió del cuadro y
   * no ocupa la jornada de nadie.
   */
  async conduccionesDeLaJornada(fecha: Date): Promise<ConduccionDeLaJornada[]> {
    const filas = await this.prisma.operativo.findMany({
      where: { activo: true, cuadro: { fecha }, conductorId: { not: null } },
      select: {
        conductorId: true,
        identificador: true,
        horaInicio: true,
        horaFin: true,
        duracionHoras: true,
        esNocturno: true,
        vehiculo: { select: { id: true, placa: true } },
        puntoEncuentro: { select: { nombre: true } },
        puntoLibre: true,
      },
      orderBy: { horaInicio: 'asc' },
    });

    return filas.map((fila) => ({
      conductorId: fila.conductorId ?? 0,
      identificador: fila.identificador,
      horaInicio: fila.horaInicio,
      horaFin: fila.horaFin,
      horas: Number(fila.duracionHoras),
      esNocturno: fila.esNocturno,
      placa: fila.vehiculo?.placa ?? null,
      punto: fila.puntoEncuentro?.nombre ?? fila.puntoLibre ?? '',
    }));
  }

  /** Cuántos operativos usan al conductor o al vehículo. Para la baja lógica. */
  async contarOperativosDeConductor(conductorId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { conductorId } });
  }

  async contarOperativosDeVehiculo(vehiculoId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { vehiculoId } });
  }
}
