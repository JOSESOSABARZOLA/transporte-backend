/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: funcionarios.repository.ts
 * Responsabilidad: Leer y escribir el maestro de funcionarios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Único punto del submódulo que toca PrismaService para el personal.
 *
 * SIN ÍNDICES NUEVOS, y consta por qué: los dos que estas consultas necesitan ya
 * existen desde M-02, y además son PARCIALES, que es exactamente lo que hace falta.
 *
 *   idx_funcionario_area (func_area) WHERE func_activo = true
 *       cubre la consulta de personal elegible, que nunca pregunta por inactivos.
 *
 *   idx_disponibilidad_func (func_id, disp_desde, disp_hasta) WHERE func_id IS NOT NULL
 *       cubre la comprobación de ausencias, y deja fuera las filas de conductor y
 *       vehículo, que son las otras dos terceras partes de la tabla.
 *
 * Ver prisma/migrations/20260805134200_agrega_indices_parciales.
 */

import { Injectable } from '@nestjs/common';
import type {
  AreaPersonal,
  Funcionario,
  Prisma,
  RolDepartamental,
} from '@prisma/client';

import { RepositorioPrisma } from '../../../common/persistencia/repositorio-prisma';
import { PrismaService } from '../../../prisma/prisma.service';

/** Campos que la administración puede modificar de un funcionario. */
export interface CambiosFuncionario {
  cedula?: string;
  apellidos?: string;
  nombres?: string;
  telefono?: string | null;
  correoInstitucional?: string | null;
  correoPersonal?: string | null;
  cargo?: string | null;
  area?: AreaPersonal;
  tipoContrato?: Funcionario['tipoContrato'];
  direccion?: RolDepartamental;
  /**
   * Zonal de trabajo. Para el personal DMIP (OPERATIVOS/GENERAL/TECNICO) se captura en la ficha
   * (2026-09-21); para INSTRUCCION la fija la matriz de cobertura del DMIT. Nulo para el resto.
   */
  zonalId?: number | null;
  activo?: boolean;
  /** Motivo de baja (código) y su detalle. Se fijan al desactivar y se limpian al reactivar. */
  motivoBaja?: string | null;
  motivoBajaDetalle?: string | null;
}

/**
 * Lo mínimo para elegir a una persona: sin cédula y sin teléfono.
 *
 * Es la forma en la que el maestro sale del submódulo hacia quien arma el cuadro.
 */
export interface DatosParaSeleccion {
  id: number;
  apellidos: string;
  nombres: string;
  area: AreaPersonal;
  cargo: string | null;
  /**
   * Zona que la persona gestiona (`func_zonal_id`). Viaja para que la pantalla de registro
   * pueda proponer la zonal del operativo al asignarla (2026-09-24). Nula si no tiene.
   */
  zonalId: number | null;
}

export interface FiltroPersonal {
  /**
   * Una o varias. Plural desde el 2026-08-27, porque una persona puede tener más de un
   * rol departamental y ve la unión de lo que cada uno abre, como en todo el sistema.
   */
  direccion?: RolDepartamental | RolDepartamental[];
  area?: AreaPersonal;
  /** Por omisión el maestro devuelve solo el personal vigente. */
  incluirInactivos?: boolean;
}

@Injectable()
export class FuncionariosRepository extends RepositorioPrisma {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async listar(filtro: FiltroPersonal = {}): Promise<Funcionario[]> {
    return this.prisma.funcionario.findMany({
      where: {
        direccion: Array.isArray(filtro.direccion)
          ? { in: filtro.direccion }
          : filtro.direccion,
        area: filtro.area,
        // `undefined` deja el filtro fuera de la consulta y devuelve ambos estados.
        activo: filtro.incluirInactivos ? undefined : true,
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
  }

  /**
   * Personal activo de las áreas indicadas.
   *
   * Recibe las áreas y no el formulario: el repositorio no sabe qué es un formulario,
   * y averiguarlo es del servicio, que lo pide al submódulo de configuración.
   *
   * NO TRAE LA CÉDULA NI EL TELÉFONO, y es una medida de seguridad, no una
   * optimización. Esta consulta alimenta la lista que ven los departamentales; el DTO
   * ya los excluye, pero si el dato nunca se carga, un descuido futuro en el mapeo
   * tampoco puede filtrarlo. La defensa que no depende de recordar algo es la única
   * que aguanta.
   */
  async listarPorAreas(areas: AreaPersonal[]): Promise<DatosParaSeleccion[]> {
    if (areas.length === 0) return [];

    return this.prisma.funcionario.findMany({
      where: { activo: true, area: { in: areas } },
      select: {
        id: true,
        apellidos: true,
        nombres: true,
        area: true,
        cargo: true,
        zonalId: true,
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
  }

  async buscarPorId(id: number): Promise<Funcionario | null> {
    return this.prisma.funcionario.findUnique({ where: { id } });
  }

  async buscarPorCedula(cedula: string): Promise<Funcionario | null> {
    return this.prisma.funcionario.findUnique({ where: { cedula } });
  }

  async crear(
    datos: Prisma.FuncionarioUncheckedCreateInput,
    cliente: Prisma.TransactionClient,
  ): Promise<Funcionario> {
    return cliente.funcionario.create({ data: datos });
  }

  /** Existe una zonal ACTIVA con ese id. Para validar la zonal de la ficha (2026-09-21). */
  async existeZonalActiva(zonalId: number): Promise<boolean> {
    const zonal = await this.prisma.zonal.findFirst({
      where: { id: zonalId, activo: true },
      select: { id: true },
    });
    return zonal !== null;
  }

  async actualizar(
    id: number,
    cambios: CambiosFuncionario,
    cliente: Prisma.TransactionClient,
  ): Promise<Funcionario> {
    return cliente.funcionario.update({ where: { id }, data: cambios });
  }

  /** RF-055. Cuántos operativos históricos registran a esta persona. */
  async contarAsignaciones(funcionarioId: number): Promise<number> {
    return this.prisma.asignacionPersonal.count({ where: { funcionarioId } });
  }
}
