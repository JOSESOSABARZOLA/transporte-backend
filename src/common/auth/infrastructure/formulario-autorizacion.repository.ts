/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: formulario-autorizacion.repository.ts
 * Responsabilidad: Consultar en la base qué puede hacer cada rol en un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05 · varios roles por formulario desde el 2026-08-25
 *
 * Único punto de la cadena de autorización que toca la persistencia.
 *
 * DEVUELVE LAS FILAS, NO UN VEREDICTO. Quién puede escribir depende de los roles de
 * quien pregunta, y eso lo sabe la guarda; aquí solo se lee lo que dice la base. Que el
 * repositorio decidiera obligaría a pasarle la identidad, y entonces esta consulta no
 * podría cachearse ni reutilizarse desde otras pantallas.
 */

import { Injectable } from '@nestjs/common';
import type { AccesoFormulario, RolDepartamental } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/** Lo que un rol concreto puede hacer en el formulario. */
export interface RolDelFormulario {
  rol: RolDepartamental;
  acceso: AccesoFormulario;
  /** Máximo de personas que puede asignar. Solo en `APORTA`. */
  cupo: number | null;
}

export interface AutorizacionFormulario {
  codigo: string;
  nombre: string;
  /**
   * Departamento responsable. **No decide la autorización** desde el 2026-08-25: está
   * aquí porque la Matriz Consolidada lo necesita para nombrar al responsable y para
   * saber qué ventana mirar en su fila de evidencia.
   */
  rolDueno: RolDepartamental;
  roles: RolDelFormulario[];
  activo: boolean;
}

@Injectable()
export class FormularioAutorizacionRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve la participación departamental del formulario, o null si no existe. */
  async buscarPorCodigo(
    codigo: string,
  ): Promise<AutorizacionFormulario | null> {
    return this.prisma.formulario.findUnique({
      where: { codigo },
      select: {
        codigo: true,
        nombre: true,
        rolDueno: true,
        activo: true,
        roles: {
          select: { rol: true, acceso: true, cupo: true },
          orderBy: { rol: 'asc' },
        },
      },
    });
  }
}
