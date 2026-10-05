/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.repository.ts
 * Responsabilidad: Leer la jornada completa para el rol que la consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-26
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ES UNA COPIA DE `matriz.repository.ts`, Y LO ES A PROPÓSITO.
 *
 * P-13 y P-04 pintan lo mismo con permisos distintos: la matriz es del Director y esto
 * es del DMIT. Compartir el repositorio significaría que un cambio pedido por un perfil
 * llega al otro sin que nadie lo decida, y **el que se llevaría la sorpresa es el que
 * más se restringe**. La separación física es aquí una propiedad de seguridad, no una
 * torpeza de diseño.
 *
 * Lo que sí se comparte es `reglas-matriz.ts`: son reglas de dominio —la evidencia del
 * formulario vacío, la hora institucional— y duplicarlas daría dos versiones de la misma
 * norma que empezarían a discrepar en cuanto se corrigiera una.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * DE SOLO LECTURA. No tiene un solo método de escritura, y esa ausencia es la garantía.
 * Una consulta por colección, por el mismo motivo que M-19: nueve formularios con sus
 * operativos, cada uno con personal, zonales e instituciones, compuesto por fila serían
 * cientos de consultas para dibujar una pantalla.
 */

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/** Operativo con lo que la jornada muestra en pantalla. */
export type OperativoDeJornada = Prisma.OperativoGetPayload<{
  include: {
    formulario: true;
    puntoEncuentro: { include: { zonal: true } };
    tipoControl: true;
    tiposControl: { include: { tipo: true } };
    zonales: { include: { zonal: true } };
    instituciones: { include: { institucion: true } };
    personal: { include: { funcionario: true } };
    observaciones: true;
    conductor: true;
    vehiculo: true;
    origen: { select: { identificador: true } };
  };
}>;

/**
 * Formulario con sus roles y sus áreas. **Ninguna de las dos es decorativa aquí.**
 *
 * `roles` es de donde sale si la sección llega editable o de solo lectura para quien
 * consulta. `areas` es de donde sale **qué personal se espera de quien consulta**: un
 * formulario admite varias áreas y el rol que solo aporta pone únicamente la suya —la
 * marcada `esCompartida`—, de modo que sin esta relación no se puede distinguir «falta
 * personal» de «falta el personal que a usted le toca». Ver PER-06.
 */
export type FormularioDeJornada = Prisma.FormularioGetPayload<{
  include: { roles: true; areas: true };
}>;

const RELACIONES = {
  formulario: true,
  puntoEncuentro: { include: { zonal: true } },
  tipoControl: true,
  // Orden DETERMINISTA por nombre (2026-09-21): el 8 admite varios tipos y la fusión compara el
  // arreglo; sin orden fijo, dos copias con los mismos tipos en distinto orden no se agrupaban.
  tiposControl: {
    include: { tipo: true },
    orderBy: { tipo: { nombre: 'asc' } },
  },
  zonales: { include: { zonal: true }, orderBy: { orden: 'asc' } },
  // Orden DETERMINISTA por sigla (2026-09-21): sin `orderBy` el motor las devolvía en orden
  // arbitrario, y dos copias del 8 con las MISMAS instituciones en distinto orden no se fundían
  // (la clave de fusión compara el arreglo). Con el orden fijo, las copias vuelven a agruparse.
  instituciones: {
    include: { institucion: true },
    orderBy: { institucion: { sigla: 'asc' } },
  },
  personal: {
    include: { funcionario: true },
    orderBy: [{ esResponsable: 'desc' }, { id: 'asc' }],
  },
  observaciones: { orderBy: { creadoEn: 'asc' } },
  conductor: true,
  vehiculo: true,
  /** Solo el identificador: el operativo del que nace ya tiene su fila en la sección. */
  origen: { select: { identificador: true } },
} satisfies Prisma.OperativoInclude;

@Injectable()
export class JornadaRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Los formularios vigentes, en el orden de presentación del cuadro.
   *
   * Se traen TODOS, tengan o no operativos: los vacíos son los que pueden llevar fila de
   * evidencia (RN-53), y los ajenos son los que la pantalla muestra en lectura.
   */
  async listarFormularios(): Promise<FormularioDeJornada[]> {
    return this.prisma.formulario.findMany({
      where: { activo: true },
      include: { roles: true, areas: true },
      orderBy: { orden: 'asc' },
    });
  }

  /**
   * Todos los operativos de la jornada, con sus relaciones. **Una consulta.**
   *
   * Sin filtro de rol: el filtro de esta pantalla es de *escritura*, no de lectura, y se
   * aplica marcando cada sección más arriba. Quién puede llegar hasta aquí lo decide el
   * `@Roles` del controlador.
   */
  async listarOperativos(fecha: Date): Promise<OperativoDeJornada[]> {
    return this.prisma.operativo.findMany({
      where: { activo: true, cuadro: { fecha } },
      include: RELACIONES,
      /** Lo planificado primero y los adicionales detrás, como en el documento firmado. */
      orderBy: [
        { formularioId: 'asc' },
        { origenId: { sort: 'asc', nulls: 'first' } },
        { secuencial: 'asc' },
      ],
    });
  }
}
