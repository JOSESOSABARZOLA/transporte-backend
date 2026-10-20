/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: traslados.service.ts
 * Responsabilidad: Administrar la matriz de traslados entre zonales (minutos).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * La matriz es EXPLÍCITA y escasa: solo guarda los pares que difieren de la regla general
 * (misma zona / mismo sector / otro sector, por parámetro). Un par sin fila usa la regla general;
 * enviar `minutos: null` borra el par y lo devuelve a ella. Ver `politicas/traslados.ts`.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import { ValidacionError } from '../../../common/errors/errores-dominio';
import type { Autor } from '../../operativos/application/operativos.service';
import { PlanificacionTransporteRepository } from '../infrastructure/planificacion-transporte.repository';
import { ParametrosTransporteService } from './parametros-transporte.service';
import { paresSinTiempo } from './politicas/traslados';

export interface ParTraslado {
  zonalOrigenId: number;
  zonalDestinoId: number;
  minutos: number | null;
}

/**
 * La explicación de una zonal en la matriz de traslados (2026-10-06). «DMQ» es TODO el Distrito
 * Metropolitano de Quito (operativos de alcance distrital): no tiene sector y sus traslados usan la
 * regla de otro sector. Otra zonal sin sector simplemente no lo tiene asignado. Con sector, nada.
 */
/**
 * ¿Esta zonal representa TODO el distrito (2026-10-06)? La zonal sin sector cuyo nombre normalizado
 * es «DMQ», o la que tiene la marca `esDmq` (2026-10-13: el DMQ ya se puede RENOMBRAR desde
 * Catálogos del cuadro, así que el nombre solo no basta). La matriz de traslados la EXCLUYE: un operativo distrital no tiene un punto de partida
 * propio, así que sus traslados siempre se calculan con la regla general de otro sector.
 */
export function esTodoElDistrito(
  nombre: string,
  sector: string | null,
  esDmq = false,
): boolean {
  return sector === null && (esDmq || nombre.trim().toUpperCase() === 'DMQ');
}

export function describirZonal(
  nombre: string,
  sector: string | null,
  esDmq = false,
): string | null {
  if (sector !== null) return null;
  if (esTodoElDistrito(nombre, sector, esDmq)) {
    return 'Todo el distrito de Quito (sin sector: los traslados usan la regla de otro sector)';
  }
  return 'Sin sector asignado';
}

@Injectable()
export class TrasladosService {
  constructor(
    private readonly repositorio: PlanificacionTransporteRepository,
    private readonly parametros: ParametrosTransporteService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Zonales (con sector), los pares explícitos, la regla general vigente y `cobertura`
   * (`{ posibles, sinTiempo }`): cuántos pares usan todavía la regla general.
   */
  async matriz() {
    const [zonales, pares, parametros] = await Promise.all([
      this.repositorio.zonalesActivas(),
      this.repositorio.traslados(),
      this.parametros.leer(),
    ]);
    return {
      zonales: zonales.map((z) => ({
        id: z.id,
        nombre: z.nombre,
        sector: z.sector,
        descripcion: describirZonal(z.nombre, z.sector, z.esDmq),
        esTodoElDistrito: esTodoElDistrito(z.nombre, z.sector, z.esDmq),
      })),
      pares,
      reglaGeneral: parametros.asignacion.traslado,
      // Para reportarlos en pantalla: una zonal sin sector usa siempre la regla de OTRO sector.
      // DMQ (todo el distrito) NO cuenta: no es un dato pendiente sino su naturaleza.
      zonalesSinSector: zonales
        .filter(
          (z) =>
            z.sector === null && !esTodoElDistrito(z.nombre, z.sector, z.esDmq),
        )
        .map((z) => ({ id: z.id, nombre: z.nombre })),
      // G7 (2026-10-15): cuántos pares (sin el DMQ) siguen con la regla general, para el aviso.
      cobertura: paresSinTiempo(
        zonales
          .filter((z) => !esTodoElDistrito(z.nombre, z.sector, z.esDmq))
          .map((z) => z.id),
        pares,
      ),
    };
  }

  async guardar(
    pares: ParTraslado[],
    autor: Autor,
  ): Promise<{ guardados: number }> {
    if (pares.length === 0) return { guardados: 0 };
    const zonales = new Set(
      (await this.repositorio.zonalesActivas()).map((z) => z.id),
    );
    for (const par of pares) {
      if (!zonales.has(par.zonalOrigenId) || !zonales.has(par.zonalDestinoId)) {
        throw new ValidacionError(
          'Alguna de las zonales indicadas no existe o está inactiva.',
          {
            par,
          },
        );
      }
      if (par.zonalOrigenId === par.zonalDestinoId) {
        throw new ValidacionError(
          'El traslado dentro de la misma zonal lo fija el parámetro TRASLADO_MISMA_ZONA_MIN.',
          { par },
        );
      }
    }
    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.guardarTraslados(pares, cliente);
      await this.auditoria.registrar(
        {
          entidad: 't_traslado_zonal',
          entidadId: 0,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: pares.map((p) => ({
            campo: `${p.zonalOrigenId}-${p.zonalDestinoId}`,
            valorNuevo: p.minutos === null ? '' : String(p.minutos),
          })),
          usuario: autor.usuarioId,
          rol: autor.rol,
        },
        cliente,
      );
    });
    return { guardados: pares.length };
  }
}
