/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Capacidad de flota
 * Archivo: capacidad-flota.repository.ts
 * Responsabilidad: Leer y escribir la capacidad declarada por fecha.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * UNA FILA POR FECHA, y el modelo lo impone dos veces: `uq_capacidad_fecha` y
 * `uq_capacidad_cuadro`. Por eso la declaración es un `upsert` y no un `create`: es el
 * caso 4 del plan —la segunda declaración actualiza, no duplica— y así lo resuelve la
 * base, no una comprobación previa que dejaría hueco entre la lectura y la escritura.
 *
 * LA CAPACIDAD CUELGA DEL CUADRO. `capa_cuad_id` es obligatoria, de modo que no se puede
 * declarar capacidad para un día que nadie abrió. El servicio lo traduce a un 404 con una
 * frase, en lugar de dejar que salte la clave foránea.
 */

import { Injectable } from '@nestjs/common';
import type { CapacidadFlota, Prisma } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

export interface DatosCapacidad {
  cuadroId: number;
  fecha: Date;
  vehiculosHabiles: number;
  conductoresHabiles: number;
  observacion: string | null;
  declaradoPor: number;
}

@Injectable()
export class CapacidadFlotaRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async buscarPorFecha(fecha: Date): Promise<CapacidadFlota | null> {
    return this.prisma.capacidadFlota.findUnique({ where: { fecha } });
  }

  /** Caso 4 del plan. La segunda declaración de la fecha actualiza la primera. */
  async declarar(
    datos: DatosCapacidad,
    cliente: Prisma.TransactionClient,
  ): Promise<CapacidadFlota> {
    return cliente.capacidadFlota.upsert({
      where: { fecha: datos.fecha },
      create: datos,
      update: {
        vehiculosHabiles: datos.vehiculosHabiles,
        conductoresHabiles: datos.conductoresHabiles,
        observacion: datos.observacion,
        declaradoPor: datos.declaradoPor,
        declaradoEn: new Date(),
      },
    });
  }
}
