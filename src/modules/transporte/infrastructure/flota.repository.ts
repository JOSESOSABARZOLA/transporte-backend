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
  EstadoMantenimiento,
  TipoTramo,
  type Conductor,
  type DestinoVehiculo,
  type Disponibilidad,
  type Prisma,
  type SectorCiudad,
  type TipoContrato,
  type TipoUbicacionVehiculo,
  type UbicacionFlota,
  type Vehiculo,
} from '@prisma/client';

import { autoresPorIds } from '../../../common/notas/autores';
import { duracionEnHoras } from '../../operativos/domain/rango-horario';
import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  DestinoParaBaja,
  ParadaParaBaja,
  TramoParaBaja,
} from '../application/politicas/baja-flota';

/**
 * Una cita de taller LISTO devolvió el vehículo a circulación: no lo tiene en el taller. Con `null`
 * (paradas anteriores a la Fase 5) sí cuenta. Explícito porque `NOT` dejaría fuera los nulos.
 */
const SIN_CITA_LISTA = {
  OR: [
    { estadoMantenimiento: null },
    { estadoMantenimiento: { not: EstadoMantenimiento.LISTO } },
  ],
} satisfies Prisma.DisponibilidadWhereInput;

/** El zonal asociado a una ubicación, con su NOMBRE para mostrarlo (2026-10-06). */
const CON_ZONAL = { zonal: { select: { id: true, nombre: true } } } as const;

/** Una ubicación de flota con su zonal (o `null`, p. ej. el garaje «Matriz»). */
export type UbicacionConZonal = UbicacionFlota & {
  zonal: { id: number; nombre: string } | null;
};

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
  /** Acta de parqueadero (Art. 8, 2026-10-06): sin acta vigente no se declara DOMICILIO. */
  actaParqueaderoNumero?: string | null;
  actaParqueaderoDesde?: Date | null;
  actaParqueaderoHasta?: Date | null;
  /** Patrón de rotación (2026-10-07). */
  patronRotacion?: string | null;
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
  actaParqueaderoNumero?: string | null;
  actaParqueaderoDesde?: Date | null;
  actaParqueaderoHasta?: Date | null;
  /** Patrón de rotación (2026-10-07). */
  patronRotacion?: string | null;
  /** Cuándo y quién lo dio de baja (2026-10-20); `null` al reactivar. */
  bajaEn?: Date | null;
  bajaPor?: number | null;
}

/** Los datos de flota del 2026-10-06 (tipo, asientos, kilometraje, matrícula, SOAT). */
export interface DatosFichaVehiculo {
  tipo?: string | null;
  asientos?: number | null;
  kilometraje?: number | null;
  matriculaVencimiento?: Date | null;
  soatVencimiento?: Date | null;
}

export interface DatosVehiculo extends DatosFichaVehiculo {
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
  /** GARAJE | DOMICILIO | TALLER (2026-10-06). */
  tipo?: TipoUbicacionVehiculo | null;
  /** Quién se lo lleva a su domicilio (Fase 5): al día siguiente se le repite el vehículo. */
  conductorId?: number | null;
  /** N.º de acta con que queda en el domicilio (2026-10-08). Nulo fuera del domicilio. */
  actaNumero?: string | null;
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
  /** Zonal del taller: destino de la TAREA «Llevar a taller» (Fase 5). */
  zonalTallerId?: number | null;
  registradoPor: number;
}

/** La TAREA «Llevar a taller» que nace de una cita (Fase 5). */
export interface NuevaTareaTaller {
  mantenimientoId: number;
  vehiculoId: number;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  zonalDestinoId: number | null;
  descripcion: string;
  creadoPor: number;
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
  /** Código del rol que cargó el operativo (2026-10-07). Opcional: las pruebas antiguas no lo traen. */
  creadoPorRol?: string | null;
}

export interface CambiosVehiculo extends DatosFichaVehiculo {
  placa?: string;
  descripcion?: string | null;
  activo?: boolean;
  /** Cuándo y quién lo dio de baja (2026-10-20); `null` al reactivar. */
  bajaEn?: Date | null;
  bajaPor?: number | null;
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
      orderBy: [{ activo: 'desc' }, { nombreCompleto: 'asc' }],
    });
  }

  async buscarConductor(id: number): Promise<ConductorConVehiculo | null> {
    return this.prisma.conductor.findUnique({
      where: { id },
      include: { vehiculoHabitual: true },
    });
  }

  /** El conductor ACTIVO que tiene el vehículo como habitual (el que se lo llevaría a casa). */
  async conductorHabitualDe(vehiculoId: number): Promise<Conductor | null> {
    return this.prisma.conductor.findFirst({
      where: { vehiculoHabitualId: vehiculoId, activo: true },
      orderBy: { id: 'asc' },
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
      orderBy: [{ activo: 'desc' }, { placa: 'asc' }],
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
   *
   * Una cita LISTO ya no lo detiene (2026-10-20): el vehículo volvió del taller, igual que en
   * «Planificar el día» (`vehiculosEnTaller`). Antes esta ruta lo seguía rechazando.
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
        ...SIN_CITA_LISTA,
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

  /** Ausencia del vehículo en la fecha. `MANTENIMIENTO` es la suya; una cita LISTO no cuenta. */
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
        ...SIN_CITA_LISTA,
      },
      select: { estado: true, hasta: true },
      orderBy: { hasta: 'desc' },
    });
  }

  // ─────────────── Ubicaciones y destino del vehículo · RN-DAF-03 ───────────────

  async listarUbicaciones(soloActivas = true): Promise<UbicacionConZonal[]> {
    return this.prisma.ubicacionFlota.findMany({
      where: soloActivas ? { activo: true } : {},
      include: CON_ZONAL,
      orderBy: [
        { activo: 'desc' },
        { garajeAutorizado: 'desc' },
        { nombre: 'asc' },
      ],
    });
  }

  async buscarUbicacion(id: number): Promise<UbicacionConZonal | null> {
    return this.prisma.ubicacionFlota.findUnique({
      where: { id },
      include: CON_ZONAL,
    });
  }

  /** Todos los nombres (activos e inactivos), para el control de duplicados sin tildes. */
  async nombresDeUbicaciones(): Promise<{ id: number; nombre: string }[]> {
    return this.prisma.ubicacionFlota.findMany({
      select: { id: true, nombre: true },
    });
  }

  async crearUbicacion(
    nombre: string,
    cliente: Prisma.TransactionClient,
    extra: { garajeAutorizado?: boolean; zonalId?: number | null } = {},
  ): Promise<UbicacionConZonal> {
    return cliente.ubicacionFlota.create({
      data: { nombre, ...extra },
      include: CON_ZONAL,
    });
  }

  async actualizarUbicacion(
    id: number,
    cambios: {
      nombre?: string;
      activo?: boolean;
      garajeAutorizado?: boolean;
      zonalId?: number | null;
      bajaEn?: Date | null;
      bajaPor?: number | null;
    },
    cliente: Prisma.TransactionClient,
  ): Promise<UbicacionConZonal> {
    return cliente.ubicacionFlota.update({
      where: { id },
      data: cambios,
      include: CON_ZONAL,
    });
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
      data: {
        ...datos,
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        estadoMantenimiento: EstadoMantenimiento.PROGRAMADO,
      },
    });
  }

  /** Crea la TAREA de taller (sin conductor todavía: se asigna como un bloque más). */
  async crearTareaTaller(
    datos: NuevaTareaTaller,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.tramoTransporte.create({
      data: { ...datos, tipo: TipoTramo.TAREA, operativoId: null },
    });
  }

  async actualizarEstadoMantenimiento(
    id: number,
    estado: EstadoMantenimiento,
    cliente: Prisma.TransactionClient,
  ): Promise<Disponibilidad> {
    return cliente.disponibilidad.update({
      where: { id },
      data: { estadoMantenimiento: estado },
    });
  }

  async eliminarMantenimiento(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.disponibilidad.delete({ where: { id } });
  }

  /**
   * P-14. Lo que cada conductor ya conduce ese día, en orden: sus TRAMOS (2026-10-14).
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * UNA SOLA CONSULTA PARA TODA LA JORNADA, no una por conductor.
   *
   * El tablero pinta treinta y cuatro conductores; pedir sus tramos de uno en uno serían
   * treinta y cuatro viajes cada vez que la DAF cambia de fecha. Se traen todos los tramos
   * del día que tienen conductor y el servicio los agrupa en memoria.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * DESDE EL 2026-10-14 SE LEEN LOS TRAMOS, no `t_operativo.cond_id`: un «dejar y retirar» son
   * dos tramos cortos y el hueco intermedio es del conductor. Un tramo de un operativo retirado
   * no cuenta; una TAREA de taller sí (es conducir), con su descripción como identificador.
   */
  async conduccionesDeLaJornada(fecha: Date): Promise<ConduccionDeLaJornada[]> {
    const filas = await this.prisma.tramoTransporte.findMany({
      where: {
        fecha,
        conductorId: { not: null },
        OR: [{ operativoId: null }, { operativo: { activo: true } }],
      },
      select: {
        conductorId: true,
        tipo: true,
        horaInicio: true,
        horaFin: true,
        descripcion: true,
        vehiculo: { select: { placa: true } },
        operativo: {
          select: {
            identificador: true,
            esNocturno: true,
            puntoEncuentro: { select: { nombre: true } },
            puntoLibre: true,
            creadoPorRol: true,
          },
        },
      },
      orderBy: [{ horaInicio: 'asc' }, { id: 'asc' }],
    });

    return filas.map((fila) => ({
      conductorId: fila.conductorId ?? 0,
      identificador: fila.operativo
        ? `${fila.operativo.identificador} (${fila.tipo.toLowerCase()})`
        : (fila.descripcion ?? 'Tarea de taller'),
      horaInicio: fila.horaInicio,
      horaFin: fila.horaFin,
      horas: duracionEnHoras(fila.horaInicio, fila.horaFin),
      esNocturno: fila.operativo?.esNocturno ?? false,
      placa: fila.vehiculo?.placa ?? null,
      punto:
        fila.operativo?.puntoEncuentro?.nombre ??
        fila.operativo?.puntoLibre ??
        '',
      creadoPorRol: fila.operativo?.creadoPorRol ?? null,
    }));
  }

  /** Cuántos operativos usan al conductor o al vehículo. Para la baja lógica. */
  async contarOperativosDeConductor(conductorId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { conductorId } });
  }

  async contarOperativosDeVehiculo(vehiculoId: number): Promise<number> {
    return this.prisma.operativo.count({ where: { vehiculoId } });
  }

  // ─────────────────────── Flota y garajes (2026-10-14) ───────────────────────

  /**
   * Lo que necesitan los indicadores de la pantalla, en CUATRO consultas sin importar el tamaño de
   * la flota: los vehículos con sus vencimientos, los conductores con el estado de su vehículo
   * habitual, los garajes con sus dos marcas y los vehículos que `hoy` están en el taller (una cita
   * que lo cubre y no está LISTO, 2026-10-20). La cuenta la hace `resumenDeFlota` (pura).
   */
  async datosDelResumen(hoy: Date) {
    return Promise.all([
      this.prisma.vehiculo.findMany({
        select: {
          id: true,
          activo: true,
          matriculaVencimiento: true,
          soatVencimiento: true,
        },
      }),
      this.prisma.conductor.findMany({
        select: {
          activo: true,
          vehiculoHabitualId: true,
          vehiculoHabitual: { select: { activo: true } },
          tipoContrato: true,
          patronRotacion: true,
        },
      }),
      this.prisma.ubicacionFlota.findMany({
        select: { activo: true, garajeAutorizado: true },
      }),
      this.prisma.disponibilidad.findMany({
        where: {
          vehiculoId: { not: null },
          estado: EstadoDisponibilidad.MANTENIMIENTO,
          desde: { lte: hoy },
          hasta: { gte: hoy },
          ...SIN_CITA_LISTA,
        },
        select: { vehiculoId: true },
      }),
    ]);
  }

  /**
   * «Vehículos que lo usan»: la ÚLTIMA fecha en que cada vehículo quedó en cada garaje, según
   * `t_destino_vehiculo`. Dos consultas (la agrupación y las placas), no una por garaje.
   */
  async usosDeUbicaciones(
    ubicacionIds?: readonly number[],
  ): Promise<
    Map<number, { vehiculoId: number; placa: string; ultimaFecha: Date }[]>
  > {
    const grupos = await this.prisma.destinoVehiculo.groupBy({
      by: ['ubicacionId', 'vehiculoId'],
      where: {
        ubicacionId: ubicacionIds ? { in: [...ubicacionIds] } : { not: null },
      },
      _max: { fecha: true },
    });

    const placas = new Map(
      (
        await this.prisma.vehiculo.findMany({
          where: { id: { in: [...new Set(grupos.map((g) => g.vehiculoId))] } },
          select: { id: true, placa: true },
        })
      ).map((v) => [v.id, v.placa]),
    );

    const porUbicacion = new Map<
      number,
      { vehiculoId: number; placa: string; ultimaFecha: Date }[]
    >();
    for (const grupo of grupos) {
      if (grupo.ubicacionId === null || !grupo._max.fecha) continue;
      const lista = porUbicacion.get(grupo.ubicacionId) ?? [];
      lista.push({
        vehiculoId: grupo.vehiculoId,
        placa: placas.get(grupo.vehiculoId) ?? '',
        ultimaFecha: grupo._max.fecha,
      });
      porUbicacion.set(grupo.ubicacionId, lista);
    }
    for (const lista of porUbicacion.values()) {
      lista.sort(
        (a, b) =>
          b.ultimaFecha.getTime() - a.ultimaFecha.getTime() ||
          a.placa.localeCompare(b.placa),
      );
    }
    return porUbicacion;
  }

  /**
   * Los TRAMOS del conductor o del vehículo desde `desde` (inclusive), para decidir su baja
   * (`politicas/baja-flota.ts`, D2 del 2026-10-20). Lee solo los tramos —la ocupación real desde el
   * 2026-10-14—, no el reflejo `t_operativo.cond_id/vehi_id`: un operativo cuyos tramos se liberaron
   * ya no bloquea. Los de un operativo retirado no cuentan. Las TAREAS de taller se devuelven
   * marcadas: cuentan para el conductor (las conduce) y no para el vehículo (la parada ya bloquea).
   * Una consulta; la hora de fin decide la política.
   */
  async tramosParaBaja(
    filtro: { conductorId: number } | { vehiculoId: number },
    desde: Date,
  ): Promise<TramoParaBaja[]> {
    const filas = await this.prisma.tramoTransporte.findMany({
      where: {
        ...filtro,
        fecha: { gte: desde },
        OR: [{ operativoId: null }, { operativo: { activo: true } }],
      },
      select: {
        fecha: true,
        horaInicio: true,
        horaFin: true,
        cruzaMedianoche: true,
        descripcion: true,
        operativo: { select: { identificador: true } },
      },
    });
    return filas.map((t) => ({
      fecha: t.fecha.toISOString().slice(0, 10),
      horaInicio: t.horaInicio,
      horaFin: t.horaFin,
      cruzaMedianoche: t.cruzaMedianoche,
      identificador:
        t.operativo?.identificador ?? t.descripcion ?? 'Tarea de taller',
      esTarea: t.operativo === null,
    }));
  }

  /** Las paradas de taller del vehículo que terminan desde `desde`. Para su baja (D2). */
  async paradasParaBaja(
    vehiculoId: number,
    desde: Date,
  ): Promise<ParadaParaBaja[]> {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        vehiculoId,
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        hasta: { gte: desde },
      },
      select: {
        desde: true,
        hasta: true,
        motivo: true,
        estadoMantenimiento: true,
      },
    });
    return filas.map((p) => ({
      desde: p.desde.toISOString().slice(0, 10),
      hasta: p.hasta.toISOString().slice(0, 10),
      motivo: p.motivo,
      estado: p.estadoMantenimiento,
    }));
  }

  /**
   * Los traslados de operativos activos que la placa tiene entre `desde` y `hasta` (2026-10-20, D4):
   * el aviso antes de programar una parada. Mismo patrón que `tramosEnRango` de las ausencias del
   * conductor. Una consulta.
   */
  async tramosDeVehiculoEnRango(
    vehiculoId: number,
    desde: Date,
    hasta: Date,
  ): Promise<
    {
      operativoId: number;
      identificador: string;
      fecha: Date;
      horaInicio: string;
      horaFin: string;
    }[]
  > {
    const tramos = await this.prisma.tramoTransporte.findMany({
      where: {
        vehiculoId,
        fecha: { gte: desde, lte: hasta },
        operativoId: { not: null },
        operativo: { activo: true },
      },
      select: {
        operativoId: true,
        fecha: true,
        horaInicio: true,
        horaFin: true,
        operativo: { select: { identificador: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });
    return tramos.flatMap((t) =>
      t.operativoId === null || !t.operativo
        ? []
        : [
            {
              operativoId: t.operativoId,
              identificador: t.operativo.identificador,
              fecha: t.fecha,
              horaInicio: t.horaInicio,
              horaFin: t.horaFin,
            },
          ],
    );
  }

  /** Los vehículos ACTIVOS que duermen en el garaje desde `desde`. Para su baja (D2). */
  async destinosParaBaja(
    ubicacionId: number,
    desde: Date,
  ): Promise<DestinoParaBaja[]> {
    const filas = await this.prisma.destinoVehiculo.findMany({
      where: { ubicacionId, fecha: { gte: desde }, vehiculo: { activo: true } },
      select: { fecha: true, vehiculo: { select: { placa: true } } },
    });
    return filas.map((d) => ({
      fecha: d.fecha.toISOString().slice(0, 10),
      placa: d.vehiculo.placa,
    }));
  }

  /** Los nombres de quienes dieron de baja, en UNA consulta (sin N+1). */
  async nombresDeUsuarios(ids: readonly (number | null)[]) {
    return autoresPorIds(this.prisma, [
      ...new Set(ids.filter((id): id is number => id !== null)),
    ]);
  }

  /** Los conductores (activos o no) que tienen el vehículo como habitual. */
  async conductoresConVehiculoHabitual(
    vehiculoId: number,
  ): Promise<{ id: number; nombreCompleto: string; activo: boolean }[]> {
    return this.prisma.conductor.findMany({
      where: { vehiculoHabitualId: vehiculoId },
      select: { id: true, nombreCompleto: true, activo: true },
      orderBy: { nombreCompleto: 'asc' },
    });
  }

  /** Deja sin vehículo habitual a esos conductores (baja del vehículo, decisión D3). */
  async quitarVehiculoHabitual(
    conductorIds: readonly number[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    if (conductorIds.length === 0) return;
    await cliente.conductor.updateMany({
      where: { id: { in: [...conductorIds] } },
      data: { vehiculoHabitualId: null },
    });
  }

  async existeZonal(id: number): Promise<boolean> {
    return (await this.prisma.zonal.count({ where: { id } })) > 0;
  }

  /**
   * Las citas de taller (MANTENIMIENTO) que se cruzan con [desde, hasta] (2026-10-06): la vista
   * semanal de vehículos parados. Una consulta.
   */
  async mantenimientosEnRango(
    desde: Date,
    hasta: Date,
  ): Promise<
    {
      id: number;
      vehiculoId: number | null;
      desde: Date;
      hasta: Date;
      estadoMantenimiento: string | null;
      motivo: string | null;
      taller: string | null;
      hora: string | null;
    }[]
  > {
    return this.prisma.disponibilidad.findMany({
      where: {
        vehiculoId: { not: null },
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
      select: {
        id: true,
        vehiculoId: true,
        desde: true,
        hasta: true,
        estadoMantenimiento: true,
        motivo: true,
        taller: true,
        hora: true,
      },
      orderBy: { desde: 'asc' },
    });
  }
}
