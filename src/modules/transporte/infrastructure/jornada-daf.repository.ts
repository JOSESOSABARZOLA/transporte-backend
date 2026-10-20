/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · planificar el día (flujo guiado en 4 pasos)
 * Archivo: jornada-daf.repository.ts
 * Responsabilidad: Leer y escribir los vehículos que salen el día y la emisión de las hojas de ruta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-08
 *
 * Dos tablas nuevas (migración 20261008150000), una fila por (fecha, vehículo) y por (fecha,
 * conductor). Se escriben con `upsert` sobre su llave única: confirmar dos veces, o emitir de nuevo,
 * deja una sola fila con lo último.
 */

import { Injectable } from '@nestjs/common';
import type { HojaRutaEmision, Prisma, VehiculoJornada } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class JornadaDafRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  // ─────────────────────────── Vehículos que salen ───────────────────────────

  async vehiculosDeJornada(fecha: Date): Promise<VehiculoJornada[]> {
    return this.prisma.vehiculoJornada.findMany({
      where: { fecha },
      orderBy: { vehiculoId: 'asc' },
    });
  }

  async guardarVehiculoJornada(
    fecha: Date,
    vehiculoId: number,
    sale: boolean,
    usuarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<VehiculoJornada> {
    return cliente.vehiculoJornada.upsert({
      where: { fecha_vehiculoId: { fecha, vehiculoId } },
      create: { fecha, vehiculoId, sale, registradoPor: usuarioId },
      update: { sale, registradoPor: usuarioId, registradoEn: new Date() },
    });
  }

  // ─────────────────────────── Hojas de ruta ───────────────────────────

  async emisionesDe(fecha: Date): Promise<HojaRutaEmision[]> {
    return this.prisma.hojaRutaEmision.findMany({ where: { fecha } });
  }

  async registrarEmision(
    fecha: Date,
    conductorId: number,
    huella: string,
    usuarioId: number,
    cliente: Prisma.TransactionClient,
  ): Promise<HojaRutaEmision> {
    return cliente.hojaRutaEmision.upsert({
      where: { fecha_conductorId: { fecha, conductorId } },
      create: { fecha, conductorId, huella, emitidaPor: usuarioId },
      update: { huella, emitidaPor: usuarioId, emitidaEn: new Date() },
    });
  }
}
