/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Homologación de roles
 * Archivo: roles-auth.repository.ts
 * Responsabilidad: Leer y administrar la correspondencia entre los roles de Auth y los del módulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-19
 *
 * LA LLAVE ES `idAuth` Y NO SE GENERA AQUÍ. Es el identificador que Auth central asigna
 * al rol —53 a 58 hoy— y lo escribe el administrador al dar de alta la correspondencia.
 * Por eso el alta es un `upsert` sobre esa llave y no un `create` con autoincremento.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma, RolAuth, RolDepartamental } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Campos que la administración puede fijar en una correspondencia. */
export interface CambiosRolAuth {
  nombreAuth?: string;
  rol?: RolDepartamental;
  subsistema?: number;
  activo?: boolean;
}

@Injectable()
export class RolesAuthRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  /** Todas las correspondencias, incluidas las inactivas: la pantalla las distingue. */
  async listar(
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<RolAuth[]> {
    return cliente.rolAuth.findMany({ orderBy: { idAuth: 'asc' } });
  }

  async buscarPorIdAuth(
    idAuth: number,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<RolAuth | null> {
    return cliente.rolAuth.findUnique({ where: { idAuth } });
  }

  async crear(
    datos: {
      idAuth: number;
      nombreAuth: string;
      rol: RolDepartamental;
      subsistema: number;
    },
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<RolAuth> {
    return cliente.rolAuth.create({ data: datos });
  }

  async actualizar(
    idAuth: number,
    cambios: CambiosRolAuth,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<RolAuth> {
    return cliente.rolAuth.update({ where: { idAuth }, data: cambios });
  }

  /**
   * Baja LÓGICA, nunca borrado.
   *
   * Igual que en los catálogos (RF-058): la fila se conserva porque explica por qué una
   * cuenta dada de alta en su día recibió el rol que recibió. Borrarla dejaría esa
   * decisión sin justificación.
   */
  async desactivar(
    idAuth: number,
    cliente: Prisma.TransactionClient = this.prisma,
  ): Promise<RolAuth> {
    return cliente.rolAuth.update({
      where: { idAuth },
      data: { activo: false },
    });
  }

  /**
   * Roles del módulo que NO tienen correspondencia activa en Auth.
   *
   * Hoy devuelve `FUNCIONARIO`, y ése es el punto: sin un rol de Transporte en Auth,
   * quien recibe una orden de servicio no puede elegir el módulo en el portal y P-06
   * queda inaccesible. Es la incidencia F-01, y la pantalla lo muestra para que el hueco
   * se vea en vez de descubrirse cuando alguien no puede entrar.
   */
  async rolesSinCorrespondencia(): Promise<RolDepartamental[]> {
    const filas = await this.prisma.$queryRaw<{ rol: RolDepartamental }[]>`
      SELECT e.enumlabel::text AS rol
      FROM unnest(enum_range(NULL::e_rol_departamental)) AS e(enumlabel)
      WHERE NOT EXISTS (
        SELECT 1 FROM t_rol_auth r
        WHERE r.rola_rol = e.enumlabel AND r.rola_activo
      )`;
    return filas.map((fila) => fila.rol);
  }
}
