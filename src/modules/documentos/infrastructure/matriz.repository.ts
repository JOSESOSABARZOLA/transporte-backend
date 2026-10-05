/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz.repository.ts
 * Responsabilidad: Leer la jornada completa en una sola consulta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DE SOLO LECTURA, Y CON UNA SOLA CONSULTA POR COLECCIÓN.
 *
 * Es el caso 7 del plan —«número de consultas acotado; sin consulta por fila»— y el
 * motivo de que este submódulo tenga repositorio propio en lugar de pedirle los datos a
 * `operativos` pieza por pieza: nueve formularios con hasta cincuenta operativos, cada
 * uno con personal, zonales, instituciones, conductor y vehículo. Compuesto a base de
 * llamadas por fila serían **cientos de consultas** para dibujar una pantalla.
 *
 * La licencia es la misma que declararon M-11, M-12 y M-13: una lectura, sin importar el
 * repositorio de otro submódulo y sin escribir nada. `MatrizRepository` **no tiene un
 * solo método de escritura**, y esa ausencia es la garantía.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * TRAE CONDUCTOR Y VEHÍCULO, que la carga anticipada de `operativos` no incluye. Ahí se
 * dejaron fuera a propósito —dos `JOIN` en cada listado de la jornada para un dato que
 * solo la matriz y la pantalla de transporte usan—, y aquí sí hacen falta: son dos de las
 * diez columnas del documento.
 */

import { Injectable } from '@nestjs/common';
import type { CuadroDiario, Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/** Operativo con todo lo que la matriz imprime. */
export type OperativoDeMatriz = Prisma.OperativoGetPayload<{
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

/** Formulario con sus prefijos, para la cabecera de cada sección. */
export type FormularioDeMatriz = Prisma.FormularioGetPayload<{
  include: { areas: true; prefijos: true; roles: true };
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
  /**
   * De qué operativo nace, si es un adicional. 2026-08-20.
   *
   * SOLO EL IDENTIFICADOR. La matriz necesita **nombrar** el origen —«Adicional de
   * OCPMO-001»—, no repetir sus datos: el operativo del que nace ya tiene su propia fila
   * unas líneas más arriba, en la misma sección.
   */
  origen: { select: { identificador: true } },
} satisfies Prisma.OperativoInclude;

@Injectable()
export class MatrizRepository {
  constructor(private readonly prisma: PrismaService) {}

  async buscarCuadro(fecha: Date): Promise<CuadroDiario | null> {
    return this.prisma.cuadroDiario.findUnique({ where: { fecha } });
  }

  /**
   * Los nueve formularios vigentes, en el orden de presentación del cuadro.
   *
   * Se traen TODOS, tengan o no operativos: los vacíos son precisamente los que pueden
   * llevar fila de evidencia (RN-53).
   */
  async listarFormularios(): Promise<FormularioDeMatriz[]> {
    return this.prisma.formulario.findMany({
      where: { activo: true },
      include: { areas: true, prefijos: true, roles: true },
      orderBy: { orden: 'asc' },
    });
  }

  /**
   * Todos los operativos de la jornada, con sus relaciones. **Una consulta.**
   *
   * Sin paginar, y es deliberado: la matriz es el documento del día completo. Paginarla
   * produciría un PDF con la mitad del cuadro, que es peor que no tenerlo.
   */
  async listarOperativos(fecha: Date): Promise<OperativoDeMatriz[]> {
    return this.prisma.operativo.findMany({
      where: { activo: true, cuadro: { fecha } },
      include: RELACIONES,
      /**
       * ═══════════════════════════════════════════════════════════════════════════
       * LO PLANIFICADO PRIMERO, LOS ADICIONALES DETRÁS. Corregido el 2026-08-20.
       *
       * Ordenar solo por `secuencial` era correcto mientras hubo una sola serie. Desde
       * que el adicional numera aparte —el primero del día es el `001` aunque el
       * formulario lleve seis— **empataba con el ordinario `001` y se colaba por delante
       * del `002`**: en el documento que se archiva y se firma, una salida dispuesta por
       * urgencia aparecía como si fuera lo primero que se planificó.
       *
       * `origenId` nulo es el operativo ordinario, así que `nulls: 'first'` separa las dos
       * series conservando el orden dentro de cada una. No hace falta más: dentro de una
       * serie el secuencial ya es único por formulario y jornada.
       * ═══════════════════════════════════════════════════════════════════════════
       */
      orderBy: [
        { formularioId: 'asc' },
        { origenId: { sort: 'asc', nulls: 'first' } },
        { secuencial: 'asc' },
      ],
    });
  }
}
