/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: planificacion-transporte.repository.ts
 * Responsabilidad: Leer y escribir tramos, traslados, turnos de conductores y activaciones.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Único punto del submódulo que toca Prisma para la planificación por tramos. Toda lectura que
 * alimenta una pantalla o una evaluación se hace EN LOTE (por fecha o por rango), nunca persona por
 * persona: la línea de tiempo pinta a todos los conductores a la vez y una consulta por fila sería
 * un N+1 de decenas de viajes a la base.
 */

import { Injectable } from '@nestjs/common';
import {
  EstadoCoberturaMes,
  EstadoDisponibilidad,
  EstadoMantenimiento,
  Prisma,
  TipoTramo,
  type TurnoConductor,
} from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import {
  mesesDelRango,
  soloPublicados,
} from '../application/politicas/publicacion-turnos';

/** Un tramo con lo necesario para pintarlo y evaluarlo. */
export type TramoCompleto = Prisma.TramoTransporteGetPayload<{
  include: {
    operativo: {
      select: {
        id: true;
        identificador: true;
        formularioId: true;
        creadoPorRol: true;
        esMacrooperativo: true;
      };
    };
    conductor: { select: { id: true; nombreCompleto: true } };
    vehiculo: { select: { id: true; placa: true } };
    zonalOrigen: { select: { id: true; nombre: true; sector: true } };
    zonalDestino: { select: { id: true; nombre: true; sector: true } };
    compartidoCon: {
      select: {
        id: true;
        operativo: { select: { id: true; identificador: true } };
      };
    };
  };
}>;

const INCLUIR_TRAMO = {
  operativo: {
    select: {
      id: true,
      identificador: true,
      formularioId: true,
      creadoPorRol: true,
      // Macrooperativo (2026-10-07): confirmar no comparte con un vehículo exclusivo.
      esMacrooperativo: true,
    },
  },
  conductor: { select: { id: true, nombreCompleto: true } },
  vehiculo: { select: { id: true, placa: true } },
  zonalOrigen: { select: { id: true, nombre: true, sector: true } },
  zonalDestino: { select: { id: true, nombre: true, sector: true } },
  // Compartir unidad (2026-10-19): con qué operativo viaja, para la línea de tiempo y el resumen.
  compartidoCon: {
    select: {
      id: true,
      operativo: { select: { id: true, identificador: true } },
    },
  },
} satisfies Prisma.TramoTransporteInclude;

/** Un tramo cuenta si es una TAREA (sin operativo) o si su operativo sigue en el cuadro. */
const DE_OPERATIVO_VIGENTE = {
  OR: [{ operativoId: null }, { operativo: { activo: true } }],
} satisfies Prisma.TramoTransporteWhereInput;

/** Un operativo de la jornada con lo que la planificación necesita. */
export type OperativoDePlanificacion = Prisma.OperativoGetPayload<{
  select: {
    id: true;
    identificador: true;
    horaInicio: true;
    horaFin: true;
    cruzaMedianoche: true;
    tipoTransporte: true;
    esMacrooperativo: true;
    transporteLiberadoEn: true;
    estadoTransporte: true;
    conductorId: true;
    vehiculoId: true;
    creadoPorRol: true;
    esNocturno: true;
    compartirConId: true;
    justificacionExclusivo: true;
    compartirCon: { select: { id: true; identificador: true } };
    puntoEncuentroId: true;
    formulario: { select: { numero: true; nombre: true; esPatrulla: true } };
    zonales: {
      select: {
        orden: true;
        zonal: { select: { id: true; nombre: true; sector: true } };
      };
      orderBy: { orden: 'asc' };
    };
    personal: {
      select: {
        funcionarioId: true;
        funcionario: { select: { apellidos: true; nombres: true } };
      };
    };
  };
}>;

const SELECCION_OPERATIVO = {
  id: true,
  identificador: true,
  horaInicio: true,
  horaFin: true,
  cruzaMedianoche: true,
  tipoTransporte: true,
  esMacrooperativo: true,
  // ALV-07 (2026-10-07): el registro cambió el tipo y liberó la asignación.
  transporteLiberadoEn: true,
  estadoTransporte: true,
  conductorId: true,
  vehiculoId: true,
  creadoPorRol: true,
  // RN-44 y RN-25 del conductor (2026-10-14): patrulla y nocturnidad del bloque.
  esNocturno: true,
  // Compartir unidad (2026-10-19): la intención de quien registró y su justificación del exclusivo.
  compartirConId: true,
  justificacionExclusivo: true,
  compartirCon: { select: { id: true, identificador: true } },
  // «Completo» (2026-10-20): la unidad que lo acompaña no se mueve de su punto.
  puntoEncuentroId: true,
  formulario: { select: { numero: true, nombre: true, esPatrulla: true } },
  zonales: {
    select: {
      orden: true,
      zonal: { select: { id: true, nombre: true, sector: true } },
    },
    orderBy: { orden: 'asc' },
  },
  personal: {
    select: {
      funcionarioId: true,
      funcionario: { select: { apellidos: true, nombres: true } },
    },
  },
} satisfies Prisma.OperativoSelect;

export interface NuevoTramo {
  operativoId: number | null;
  fecha: Date;
  tipo: TipoTramo;
  horaInicio: string;
  horaFin: string;
  cruzaMedianoche: boolean;
  zonalOrigenId: number | null;
  zonalDestinoId: number | null;
  descripcion?: string | null;
  creadoPor: number;
  /** Solo al nacer ya asignado: la herencia del adicional (2026-10-14). Sin ellos, libre. */
  conductorId?: number | null;
  vehiculoId?: number | null;
}

export interface FilaTurnoConductor {
  conductorId: number;
  fecha: Date;
  turno: TurnoConductor;
}

@Injectable()
export class PlanificacionTransporteRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Operativos y tramos ───────────────────────────

  /** Los operativos activos de la jornada (por la fecha del cuadro). */
  async operativosDeFecha(fecha: Date): Promise<OperativoDePlanificacion[]> {
    return this.prisma.operativo.findMany({
      where: { activo: true, cuadro: { fecha } },
      select: SELECCION_OPERATIVO,
      orderBy: [{ horaInicio: 'asc' }, { identificador: 'asc' }],
    });
  }

  /** Unos operativos concretos, activos. */
  async operativosPorId(
    ids: readonly number[],
  ): Promise<(OperativoDePlanificacion & { cuadro: { fecha: Date } })[]> {
    if (ids.length === 0) return [];
    return this.prisma.operativo.findMany({
      where: { id: { in: [...ids] }, activo: true },
      select: { ...SELECCION_OPERATIVO, cuadro: { select: { fecha: true } } },
    });
  }

  /**
   * Los tramos de una jornada. Los de un operativo RETIRADO (`oper_activo` en falso) no cuentan
   * (2026-10-14): salió del cuadro y no ocupa a nadie. Las TAREAS (sin operativo) sí.
   */
  async tramosDeFecha(fecha: Date): Promise<TramoCompleto[]> {
    return this.prisma.tramoTransporte.findMany({
      where: { fecha, ...DE_OPERATIVO_VIGENTE },
      include: INCLUIR_TRAMO,
      orderBy: [{ horaInicio: 'asc' }, { id: 'asc' }],
    });
  }

  /** Los tramos asignados de unos días (para el descanso desde ayer). */
  async tramosAsignadosEnFechas(
    fechas: readonly Date[],
  ): Promise<TramoCompleto[]> {
    return this.prisma.tramoTransporte.findMany({
      where: {
        fecha: { in: [...fechas] },
        conductorId: { not: null },
        ...DE_OPERATIVO_VIGENTE,
      },
      include: INCLUIR_TRAMO,
    });
  }

  async tramosDeOperativos(
    operativoIds: readonly number[],
  ): Promise<TramoCompleto[]> {
    if (operativoIds.length === 0) return [];
    return this.prisma.tramoTransporte.findMany({
      where: { operativoId: { in: [...operativoIds] } },
      include: INCLUIR_TRAMO,
      orderBy: [{ horaInicio: 'asc' }, { id: 'asc' }],
    });
  }

  async buscarTramo(id: number): Promise<TramoCompleto | null> {
    return this.prisma.tramoTransporte.findUnique({
      where: { id },
      include: INCLUIR_TRAMO,
    });
  }

  async crearTramos(
    tramos: readonly NuevoTramo[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    if (tramos.length === 0) return;
    await cliente.tramoTransporte.createMany({ data: [...tramos] });
  }

  /**
   * Crea tramos y devuelve su id, tipo y asignación (2026-10-14). Lo usa la herencia del
   * adicional, que necesita los ids para dejar una traza por tramo asignado.
   */
  async crearTramosDevolviendo(
    tramos: readonly NuevoTramo[],
    cliente: Prisma.TransactionClient,
  ): Promise<
    {
      id: number;
      tipo: TipoTramo;
      conductorId: number | null;
      vehiculoId: number | null;
    }[]
  > {
    if (tramos.length === 0) return [];
    return cliente.tramoTransporte.createManyAndReturn({
      data: [...tramos],
      select: { id: true, tipo: true, conductorId: true, vehiculoId: true },
    });
  }

  /** Borra los tramos SIN conductor de un operativo (se regeneran). Los asignados no se tocan. */
  async borrarTramosLibres(
    operativoId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await cliente.tramoTransporte.deleteMany({
      where: { operativoId, conductorId: null },
    });
    return count;
  }

  async asignarTramos(
    ids: readonly number[],
    conductorId: number | null,
    vehiculoId: number | null,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    // Una asignación directa no es compartir: si el tramo viajaba con otro, deja de hacerlo.
    await cliente.tramoTransporte.updateMany({
      where: { id: { in: [...ids] } },
      data: { conductorId, vehiculoId, compartidoConTramoId: null },
    });
  }

  /**
   * Los INVITADOS de unos tramos anfitriones (2026-10-19, compartir unidad): quienes viajan en su
   * unidad. Se dejan sin conductor ni placa y sin la marca, porque su anfitrión cambió o se quitó.
   * Devuelve a quiénes soltó, con lo que tenían, para la traza y el aviso. `excluir` son tramos
   * que el llamador ya está escribiendo (no se tocan dos veces).
   */
  async liberarInvitados(
    anfitrionIds: readonly number[],
    excluir: readonly number[],
    cliente: Prisma.TransactionClient,
  ): Promise<
    {
      id: number;
      operativoId: number | null;
      conductorId: number | null;
      vehiculoId: number | null;
      compartidoConTramoId: number | null;
    }[]
  > {
    if (anfitrionIds.length === 0) return [];
    const invitados = await cliente.tramoTransporte.findMany({
      where: {
        compartidoConTramoId: { in: [...anfitrionIds] },
        id: { notIn: [...excluir] },
      },
      select: {
        id: true,
        operativoId: true,
        conductorId: true,
        vehiculoId: true,
        compartidoConTramoId: true,
      },
    });
    if (invitados.length === 0) return [];
    await cliente.tramoTransporte.updateMany({
      where: { id: { in: invitados.map((t) => t.id) } },
      data: { conductorId: null, vehiculoId: null, compartidoConTramoId: null },
    });
    return invitados;
  }

  async borrarTramo(
    id: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.tramoTransporte.delete({ where: { id } });
  }

  // ─────────────────────────── Traslados ───────────────────────────

  async traslados(): Promise<
    { zonalOrigenId: number; zonalDestinoId: number; minutos: number }[]
  > {
    return this.prisma.trasladoZonal.findMany({
      select: { zonalOrigenId: true, zonalDestinoId: true, minutos: true },
    });
  }

  async zonalesActivas(): Promise<
    { id: number; nombre: string; sector: string | null; esDmq: boolean }[]
  > {
    return this.prisma.zonal.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, sector: true, esDmq: true },
      orderBy: { orden: 'asc' },
    });
  }

  /** Sector de la ciudad de cada zonal pedida (2026-10-19, compartir unidad). Una consulta. */
  async sectoresDeZonales(
    ids: readonly number[],
  ): Promise<Map<number, string | null>> {
    if (ids.length === 0) return new Map();
    const filas = await this.prisma.zonal.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, sector: true },
    });
    return new Map(filas.map((fila) => [fila.id, fila.sector]));
  }

  /** Fija (o borra, con `minutos` nulo) pares de la matriz de traslados. */
  async guardarTraslados(
    pares: readonly {
      zonalOrigenId: number;
      zonalDestinoId: number;
      minutos: number | null;
    }[],
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    for (const par of pares) {
      const clave = {
        zonalOrigenId_zonalDestinoId: {
          zonalOrigenId: par.zonalOrigenId,
          zonalDestinoId: par.zonalDestinoId,
        },
      };
      if (par.minutos === null) {
        await cliente.trasladoZonal.deleteMany({
          where: {
            zonalOrigenId: par.zonalOrigenId,
            zonalDestinoId: par.zonalDestinoId,
          },
        });
      } else {
        await cliente.trasladoZonal.upsert({
          where: clave,
          update: { minutos: par.minutos },
          create: {
            zonalOrigenId: par.zonalOrigenId,
            zonalDestinoId: par.zonalDestinoId,
            minutos: par.minutos,
          },
        });
      }
    }
  }

  // ─────────────────────────── Conductores y flota del día ───────────────────────────

  async conductoresActivos(): Promise<
    {
      id: number;
      /** Para emparejar la importación del HORARIO por cédula (2026-10-06). */
      cedula: string;
      nombreCompleto: string;
      sector: string | null;
      tipoContrato: string | null;
      parqueaderoAutorizado: boolean;
      actaParqueaderoNumero: string | null;
      actaParqueaderoDesde: Date | null;
      actaParqueaderoHasta: Date | null;
      vehiculoHabitualId: number | null;
      /** Patrón de rotación para «Proponer el mes» (2026-10-07). */
      patronRotacion: string | null;
    }[]
  > {
    return this.prisma.conductor.findMany({
      where: { activo: true },
      select: {
        patronRotacion: true,
        id: true,
        cedula: true,
        nombreCompleto: true,
        sector: true,
        tipoContrato: true,
        parqueaderoAutorizado: true,
        actaParqueaderoNumero: true,
        actaParqueaderoDesde: true,
        actaParqueaderoHasta: true,
        vehiculoHabitualId: true,
      },
      orderBy: { nombreCompleto: 'asc' },
    });
  }

  async vehiculosActivos(): Promise<
    {
      id: number;
      placa: string;
      asientos: number | null;
      tipo: string | null;
      descripcion: string | null;
    }[]
  > {
    return this.prisma.vehiculo.findMany({
      where: { activo: true },
      select: {
        id: true,
        placa: true,
        asientos: true,
        tipo: true,
        descripcion: true,
      },
      orderBy: { placa: 'asc' },
    });
  }

  /** Conductores con ausencia (no DISPONIBLE) en la fecha. */
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
    return new Set(filas.map((f) => f.conductorId as number));
  }

  /** Vehículos en mantenimiento (taller) en la fecha. */
  async vehiculosEnTaller(fecha: Date): Promise<Set<number>> {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        vehiculoId: { not: null },
        desde: { lte: fecha },
        hasta: { gte: fecha },
        estado: EstadoDisponibilidad.MANTENIMIENTO,
        // Una cita LISTA devolvió el vehículo a circulación (Fase 5).
        OR: [
          { estadoMantenimiento: null },
          { estadoMantenimiento: { not: EstadoMantenimiento.LISTO } },
        ],
      },
      select: { vehiculoId: true },
    });
    return new Set(filas.map((f) => f.vehiculoId as number));
  }

  /** Los destinos (guarda final) de una fecha, con la zonal de su ubicación. */
  async destinosDe(fecha: Date): Promise<
    {
      vehiculoId: number;
      domicilio: boolean;
      tipo: string | null;
      observacion: string | null;
      conductorId: number | null;
      /** N.º de acta escrito al guardarlo en el domicilio (2026-10-08). */
      actaNumero: string | null;
      ubicacion: {
        id: number;
        nombre: string;
        zonal: { id: number; sector: string | null } | null;
      } | null;
    }[]
  > {
    return this.prisma.destinoVehiculo.findMany({
      where: { fecha },
      select: {
        vehiculoId: true,
        domicilio: true,
        tipo: true,
        observacion: true,
        conductorId: true,
        actaNumero: true,
        ubicacion: {
          select: {
            id: true,
            nombre: true,
            zonal: { select: { id: true, sector: true } },
          },
        },
      },
    });
  }

  // ─────────────────────────── Turnos de conductores ───────────────────────────

  async turnosEnRango(desde: Date, hasta: Date): Promise<FilaTurnoConductor[]> {
    return this.prisma.turnoConductorDia.findMany({
      where: { fecha: { gte: desde, lte: hasta } },
      select: { conductorId: true, fecha: true, turno: true },
    });
  }

  async ausenciasConductoresEnRango(
    desde: Date,
    hasta: Date,
  ): Promise<
    {
      conductorId: number;
      estado: EstadoDisponibilidad;
      desde: Date;
      hasta: Date;
    }[]
  > {
    const filas = await this.prisma.disponibilidad.findMany({
      where: {
        conductorId: { not: null },
        estado: { not: EstadoDisponibilidad.DISPONIBLE },
        desde: { lte: hasta },
        hasta: { gte: desde },
      },
      select: { conductorId: true, estado: true, desde: true, hasta: true },
    });
    return filas.map((f) => ({ ...f, conductorId: f.conductorId as number }));
  }

  async guardarTurno(
    conductorId: number,
    fecha: Date,
    turno: TurnoConductor | null,
    usuarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    if (turno === null) {
      await cliente.turnoConductorDia.deleteMany({
        where: { conductorId, fecha },
      });
      return;
    }
    await cliente.turnoConductorDia.upsert({
      where: { conductorId_fecha: { conductorId, fecha } },
      update: { turno, registradoPor: usuarioId },
      create: { conductorId, fecha, turno, registradoPor: usuarioId },
    });
  }

  /**
   * Los turnos del rango cuyo mes está PUBLICADO (2026-10-07, «publicar habilita»): lo que leen la
   * planificación, la evaluación, la capacidad y el optimizador. Dos consultas.
   */
  async turnosPublicadosEnRango(
    desde: Date,
    hasta: Date,
  ): Promise<FilaTurnoConductor[]> {
    const [turnos, publicados] = await Promise.all([
      this.turnosEnRango(desde, hasta),
      this.prisma.turnoConductorMes.findMany({
        where: {
          mes: { in: mesesDelRango(desde, hasta) },
          estado: {
            in: [
              EstadoCoberturaMes.PUBLICADO,
              EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS,
            ],
          },
        },
        select: { mes: true },
      }),
    ]);
    return soloPublicados(turnos, new Set(publicados.map((m) => m.mes)));
  }

  async estadoMes(mes: string): Promise<EstadoCoberturaMes> {
    const fila = await this.prisma.turnoConductorMes.findUnique({
      where: { mes },
    });
    return fila?.estado ?? EstadoCoberturaMes.BORRADOR;
  }

  async marcarMesConCambios(
    mes: string,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.turnoConductorMes.updateMany({
      where: { mes, estado: EstadoCoberturaMes.PUBLICADO },
      data: { estado: EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS },
    });
  }

  async publicarMes(mes: string, usuarioId: number): Promise<void> {
    const ahora = new Date();
    await this.prisma.turnoConductorMes.upsert({
      where: { mes },
      update: {
        estado: EstadoCoberturaMes.PUBLICADO,
        publicadoPor: usuarioId,
        publicadoEn: ahora,
      },
      create: {
        mes,
        estado: EstadoCoberturaMes.PUBLICADO,
        publicadoPor: usuarioId,
        publicadoEn: ahora,
      },
    });
  }

  // ─────────────────────────── Activaciones de libres ───────────────────────────

  async activacionesDe(
    fecha: Date,
  ): Promise<{ conductorId: number; motivo: string; activadoPor: number }[]> {
    return this.prisma.activacionConductor.findMany({
      where: { fecha },
      select: { conductorId: true, motivo: true, activadoPor: true },
    });
  }

  async activar(
    conductorId: number,
    fecha: Date,
    motivo: string,
    usuarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<{ id: number }> {
    return cliente.activacionConductor.upsert({
      where: { conductorId_fecha: { conductorId, fecha } },
      update: { motivo, activadoPor: usuarioId },
      create: { conductorId, fecha, motivo, activadoPor: usuarioId },
      select: { id: true },
    });
  }

  async desactivar(
    conductorId: number,
    fecha: Date,
    cliente: Prisma.TransactionClient,
  ): Promise<number> {
    const { count } = await cliente.activacionConductor.deleteMany({
      where: { conductorId, fecha },
    });
    return count;
  }

  async tramosAsignadosDelConductor(
    conductorId: number,
    fecha: Date,
  ): Promise<number> {
    return this.prisma.tramoTransporte.count({ where: { conductorId, fecha } });
  }

  // ─────────────────────────── Optimizador y fin del día (Fases 3 y 5) ───────────────────────────

  /** Los garajes autorizados activos (Art. 8), con la zonal y el sector donde están. */
  async garajesAutorizados(): Promise<
    {
      id: number;
      nombre: string;
      zonal: { id: number; sector: string | null } | null;
    }[]
  > {
    return this.prisma.ubicacionFlota.findMany({
      where: { activo: true, garajeAutorizado: true },
      select: {
        id: true,
        nombre: true,
        zonal: { select: { id: true, sector: true } },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  /**
   * Comparte carro: el tramo viaja en el vehículo, y con el conductor, de su anfitrión. Se marca
   * `compartidoConTramoId` para que la línea de tiempo y la hoja de ruta lo distingan.
   */
  async compartirTramo(
    tramoId: number,
    anfitrion: { id: number; conductorId: number; vehiculoId: number | null },
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.tramoTransporte.update({
      where: { id: tramoId },
      data: {
        compartidoConTramoId: anfitrion.id,
        conductorId: anfitrion.conductorId,
        vehiculoId: anfitrion.vehiculoId,
      },
    });
  }

  /** Los tramos de un vehículo en una fecha (para la hoja de ruta). */
  async tramosDeVehiculo(
    vehiculoId: number,
    fecha: Date,
  ): Promise<TramoCompleto[]> {
    return this.prisma.tramoTransporte.findMany({
      where: { vehiculoId, fecha },
      include: INCLUIR_TRAMO,
    });
  }

  async buscarVehiculo(
    id: number,
  ): Promise<{ id: number; placa: string; tipo: string | null } | null> {
    return this.prisma.vehiculo.findUnique({
      where: { id },
      select: { id: true, placa: true, tipo: true },
    });
  }

  /**
   * El cuadro de una fecha (si existe) con cuántos operativos ACTIVOS tiene (2026-10-06), para la
   * lista «Antes de asignar». Una sola consulta.
   */
  async cuadroDeFecha(
    fecha: Date,
  ): Promise<{ estado: string; operativos: number } | null> {
    const cuadro = await this.prisma.cuadroDiario.findUnique({
      where: { fecha },
      select: {
        estado: true,
        _count: { select: { operativos: { where: { activo: true } } } },
      },
    });
    return cuadro
      ? { estado: cuadro.estado, operativos: cuadro._count.operativos }
      : null;
  }
}
