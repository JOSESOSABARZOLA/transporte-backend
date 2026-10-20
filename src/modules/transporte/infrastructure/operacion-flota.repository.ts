/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · operación diaria de la flota (Fase 5)
 * Archivo: operacion-flota.repository.ts
 * Responsabilidad: Leer y escribir el checklist diario, el kilometraje y los vales de combustible.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * TRES TABLAS DE REGISTRO, sin reglas: las reglas (monto 10/20, kilometraje que no retrocede) viven
 * en el servicio y, de respaldo, en los CHECK de la base (`ck_vale_monto`, `ck_kilometraje_km`).
 * El checklist y el kilometraje son UNO por día (upsert sobre su único); los vales se acumulan.
 */

import { Injectable } from '@nestjs/common';
import type {
  ChecklistVehiculo,
  KilometrajeVehiculo,
  Prisma,
  ValeCombustible,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

export interface NuevoChecklist {
  vehiculoId: number;
  conductorId: number;
  fecha: Date;
  items: Record<string, boolean>;
  observacion: string | null;
  kilometrajeSalida: number | null;
  registradoPor: number;
}

export interface NuevoKilometraje {
  vehiculoId: number;
  conductorId: number | null;
  fecha: Date;
  kilometraje: number;
  registradoPor: number;
}

export interface NuevoVale {
  conductorId: number;
  vehiculoId: number;
  fecha: Date;
  monto: number;
  numero: string | null;
  registradoPor: number;
}

export type ChecklistConNombres = Prisma.ChecklistVehiculoGetPayload<{
  include: {
    vehiculo: { select: { placa: true } };
    conductor: { select: { nombreCompleto: true } };
  };
}>;

export type ValeConNombres = Prisma.ValeCombustibleGetPayload<{
  include: {
    vehiculo: { select: { placa: true } };
    conductor: { select: { nombreCompleto: true } };
  };
}>;

const CON_NOMBRES = {
  vehiculo: { select: { placa: true } },
  conductor: { select: { nombreCompleto: true } },
} as const;

@Injectable()
export class OperacionFlotaRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async existeVehiculo(
    id: number,
  ): Promise<{ id: number; placa: string; kilometraje: number | null } | null> {
    return this.prisma.vehiculo.findUnique({
      where: { id },
      select: { id: true, placa: true, kilometraje: true },
    });
  }

  async existeConductor(id: number): Promise<{ id: number } | null> {
    return this.prisma.conductor.findUnique({
      where: { id },
      select: { id: true },
    });
  }

  // ─────────── Checklist (Art. 9) ───────────

  async guardarChecklist(
    datos: NuevoChecklist,
    cliente: Prisma.TransactionClient,
  ): Promise<ChecklistVehiculo> {
    const campos = {
      items: datos.items,
      observacion: datos.observacion,
      kilometrajeSalida: datos.kilometrajeSalida,
      registradoPor: datos.registradoPor,
    };
    return cliente.checklistVehiculo.upsert({
      where: {
        vehiculoId_conductorId_fecha: {
          vehiculoId: datos.vehiculoId,
          conductorId: datos.conductorId,
          fecha: datos.fecha,
        },
      },
      create: {
        vehiculoId: datos.vehiculoId,
        conductorId: datos.conductorId,
        fecha: datos.fecha,
        ...campos,
      },
      update: campos,
    });
  }

  async checklistsDe(fecha: Date): Promise<ChecklistConNombres[]> {
    return this.prisma.checklistVehiculo.findMany({
      where: { fecha },
      include: CON_NOMBRES,
      orderBy: { creadoEn: 'asc' },
    });
  }

  // ─────────── Kilometraje ───────────

  async guardarKilometraje(
    datos: NuevoKilometraje,
    cliente: Prisma.TransactionClient,
  ): Promise<KilometrajeVehiculo> {
    const campos = {
      conductorId: datos.conductorId,
      kilometraje: datos.kilometraje,
      registradoPor: datos.registradoPor,
    };
    return cliente.kilometrajeVehiculo.upsert({
      where: {
        vehiculoId_fecha: { vehiculoId: datos.vehiculoId, fecha: datos.fecha },
      },
      create: { vehiculoId: datos.vehiculoId, fecha: datos.fecha, ...campos },
      update: campos,
    });
  }

  /** Sube el kilometraje de la ficha solo si la lectura es mayor (nunca lo hace retroceder). */
  async subirKilometrajeFicha(
    vehiculoId: number,
    kilometraje: number,
    cliente: Prisma.TransactionClient,
  ): Promise<void> {
    await cliente.vehiculo.updateMany({
      where: {
        id: vehiculoId,
        OR: [{ kilometraje: null }, { kilometraje: { lt: kilometraje } }],
      },
      data: { kilometraje },
    });
  }

  /** La lectura más alta registrada en OTRO día anterior (para rechazar retrocesos). */
  async lecturaAnterior(
    vehiculoId: number,
    fecha: Date,
  ): Promise<KilometrajeVehiculo | null> {
    return this.prisma.kilometrajeVehiculo.findFirst({
      where: { vehiculoId, fecha: { lt: fecha } },
      orderBy: [{ kilometraje: 'desc' }],
    });
  }

  async historialKilometraje(
    vehiculoId: number,
    limite: number,
  ): Promise<KilometrajeVehiculo[]> {
    return this.prisma.kilometrajeVehiculo.findMany({
      where: { vehiculoId },
      orderBy: { fecha: 'desc' },
      take: limite,
    });
  }

  // ─────────── Vales de combustible ───────────

  async crearVale(
    datos: NuevoVale,
    cliente: Prisma.TransactionClient,
  ): Promise<ValeCombustible> {
    return cliente.valeCombustible.create({ data: datos });
  }

  async valesDe(fecha: Date): Promise<ValeConNombres[]> {
    return this.prisma.valeCombustible.findMany({
      where: { fecha },
      include: CON_NOMBRES,
      orderBy: { creadoEn: 'asc' },
    });
  }
}
