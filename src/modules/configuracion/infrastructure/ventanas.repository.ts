/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Ventanas de carga
 * Archivo: ventanas.repository.ts
 * Responsabilidad: Leer y administrar las ventanas de carga de los seis roles.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * NO DUPLICA a `common/auth/infrastructure/ventana-carga.repository.ts`, igual que
 * `FormulariosRepository` no duplica al de autorización. Aquel resuelve UNA pregunta
 * para la guarda —¿cuál es la ventana de este rol?— y vive en `common` para que la
 * cadena de autorización no dependa de un submódulo de negocio. Este administra las
 * seis filas y es el que usa la pantalla del administrador.
 *
 * Se llama `VentanasRepository`, en plural, y no `VentanaCargaRepository` como lo
 * nombra el plan: dos clases con el mismo nombre en carpetas distintas se importan mal
 * tarde o temprano. Misma convención que `FormulariosRepository`.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma, RolDepartamental, VentanaCarga } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Campos que la administración puede modificar de una ventana. */
export interface CambiosVentana {
  tipo?: VentanaCarga['tipo'];
  diaApertura?: number | null;
  horaApertura?: string | null;
  diaCierre?: number | null;
  horaCierre?: string | null;
  mensajeCierre?: string;
  activo?: boolean;
}

@Injectable()
export class VentanasRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Las seis ventanas, en el orden en que se presentan al administrador. */
  async listar(): Promise<VentanaCarga[]> {
    return this.prisma.ventanaCarga.findMany({ orderBy: { id: 'asc' } });
  }

  async buscarPorRol(rol: RolDepartamental): Promise<VentanaCarga | null> {
    return this.prisma.ventanaCarga.findUnique({ where: { rol } });
  }

  async actualizar(
    rol: RolDepartamental,
    cambios: CambiosVentana,
    cliente: Prisma.TransactionClient,
  ): Promise<VentanaCarga> {
    return cliente.ventanaCarga.update({ where: { rol }, data: cambios });
  }
}
