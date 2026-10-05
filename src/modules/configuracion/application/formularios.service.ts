/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formularios.service.ts
 * Responsabilidad: Publicar la definición de los nueve formularios y su acceso por rol.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ES EL SERVICIO QUE `operativos` CONSUMIRÁ POR CONTRATO. La comunicación entre
 * submódulos es por servicio publicado: ningún otro submódulo consultará
 * `FormulariosRepository`. Ver docs/IMPLEMENTATION_GUIDE.md §6.
 *
 * LOS COLORES SALEN DE AQUÍ. El frontend no los define ni los interpreta: son dato
 * institucional del Excel aprobado y viajan en la respuesta. Ver FASE5 §10.2.
 */

import { Injectable } from '@nestjs/common';
import type { FormularioPrefijo, RolDepartamental } from '@prisma/client';

import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import {
  FormulariosRepository,
  type FormularioConAreas,
} from '../infrastructure/formularios.repository';
import {
  accesoDe,
  leCorresponde,
  type AccesoFormulario,
} from './reglas-formulario';

export interface FormularioConAcceso {
  formulario: FormularioConAreas;
  acceso: AccesoFormulario;
}

/**
 * De más autoridad a menos. El orden **es** la regla, así que vive en un solo sitio.
 *
 * `ESCRITURA` registra; `COMPARTIDO` aporta personal con cupo; `LECTURA` solo mira.
 */
const AMPLITUD: AccesoFormulario[] = ['ESCRITURA', 'COMPARTIDO', 'LECTURA'];

/** El mayor de dos accesos. Ver la nota de `obtenerPermitidos`. */
const elMasAmplio = (
  uno: AccesoFormulario,
  otro: AccesoFormulario,
): AccesoFormulario =>
  AMPLITUD.indexOf(uno) <= AMPLITUD.indexOf(otro) ? uno : otro;

@Injectable()
export class FormulariosService {
  constructor(private readonly repositorio: FormulariosRepository) {}

  /**
   * PER-01. Los formularios que el rol puede abrir, con el acceso que tiene sobre
   * cada uno. La lista NO se filtra en el cliente: llega ya filtrada.
   */
  async obtenerPermitidos(
    roles: RolDepartamental[],
  ): Promise<FormularioConAcceso[]> {
    const formularios = await this.repositorio.listarActivos();

    /*
      LA UNIÓN, no la intersección: quien tenga DAF y DMIP Operativos ve los formularios
      de ambos. Es la semántica que el negocio acordó el 2026-08-19 para «varios roles a
      la vez». Un formulario aparece UNA vez aunque dos de sus roles lo alcancen.

      ═══════════════════════════════════════════════════════════════════════════════
      EL ACCESO ES EL MÁS AMPLIO DE TODOS SUS ROLES, Y ANTES NO LO ERA. Corregido el
      2026-08-25.

      Hasta hoy se elegía **un** rol y se calculaba el acceso de ése: primero el dueño
      del formulario y, si no, «el primero que lo alcanza». Y `leCorresponde` devuelve
      cierto para cualquier rol transversal, así que en una cuenta con `DIRECTOR` o
      `ADMINISTRADOR` **más** uno departamental, el transversal iba primero, ganaba el
      sorteo y devolvía `LECTURA`.

      El efecto: la persona con Dirección + DMIT recibía el formulario 6 como LECTURA
      —su cupo desaparecía— y, desde que la patrulla ECU admite dos departamentos, la 4
      también. Los formularios 7 y 9 se salvaban por casualidad: el DMIT es su dueño, y
      la primera búsqueda acertaba.

      Con `reduce` no hay sorteo que perder: se calculan los seis y se conserva el mayor.
      ═══════════════════════════════════════════════════════════════════════════════
    */
    return formularios
      .filter((formulario) =>
        roles.some((rol) => leCorresponde(formulario, rol)),
      )
      .map((formulario) => ({
        formulario,
        acceso: roles
          .map((rol) => accesoDe(formulario, rol))
          .reduce(elMasAmplio, 'LECTURA'),
      }));
  }

  /**
   * Definición completa de un formulario vigente.
   *
   * Un código inexistente o dado de baja produce 404. A diferencia de
   * `FormularioRolGuard` —que responde «no autorizado» para no revelar qué códigos
   * existen— aquí el rol ya está autenticado y consulta el catálogo institucional:
   * ocultar la inexistencia solo dificultaría el diagnóstico.
   */
  async obtenerDefinicion(codigo: string): Promise<FormularioConAreas> {
    const formulario = await this.repositorio.buscarPorCodigo(codigo);

    if (!formulario) {
      throw new RecursoNoEncontradoError(
        `No existe un formulario vigente con el código ${codigo}.`,
        { codigo },
      );
    }
    return formulario;
  }

  /**
   * Prefijos de identificador del formulario. Publicado en M-14.
   *
   * `operativos` no puede leer `t_formulario_prefijo` por su cuenta: la delimitación de
   * los formularios pertenece a este submódulo y la comunicación es por servicio
   * publicado. Quién elige entre varios prefijos es de `operativos`; **qué prefijos
   * existen** es de aquí.
   */
  async obtenerPrefijos(formularioId: number): Promise<FormularioPrefijo[]> {
    return this.repositorio.prefijosDe(formularioId);
  }

  /** Valida que los formularios a los que se quiere vincular un valor existan. */
  async verificarExisten(formularioIds: number[]): Promise<number[]> {
    const existentes = await this.repositorio.filtrarExistentes(formularioIds);
    return formularioIds.filter((id) => !existentes.includes(id));
  }

  /**
   * Cómo se nombra cada formulario en un mensaje de error. Un rechazo que dice «no se
   * puede retirar del formulario 3» obliga a quien lo lee a ir a buscar cuál es el 3.
   */
  async describir(formularioIds: number[]): Promise<Map<number, string>> {
    const activos = await this.repositorio.listarActivos();
    return new Map(
      activos
        .filter((formulario) => formularioIds.includes(formulario.id))
        .map((formulario) => [
          formulario.id,
          `${formulario.numero} (${formulario.codigo})`,
        ]),
    );
  }
}
