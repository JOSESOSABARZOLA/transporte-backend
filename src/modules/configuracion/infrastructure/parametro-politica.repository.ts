/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: parametro-politica.repository.ts
 * Responsabilidad: Leer y escribir los umbrales de política institucional.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Único punto del submódulo que toca PrismaService. Ver docs/IMPLEMENTATION_GUIDE.md §13.3.
 */

import { Injectable } from '@nestjs/common';
import type { ParametroPolitica, Prisma } from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ParametroPoliticaRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listar(): Promise<ParametroPolitica[]> {
    return this.prisma.parametroPolitica.findMany({ orderBy: { id: 'asc' } });
  }

  async buscarPorClave(clave: string): Promise<ParametroPolitica | null> {
    return this.prisma.parametroPolitica.findUnique({ where: { clave } });
  }

  async actualizarValor(
    clave: string,
    valor: string,
    modificadoPor: number,
    cliente: Prisma.TransactionClient,
  ): Promise<ParametroPolitica> {
    return cliente.parametroPolitica.update({
      where: { clave },
      data: { valor, modificadoPor },
    });
  }
}
