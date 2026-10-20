/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Auditoría
 * Archivo: auditoria.service.ts
 * Responsabilidad: Componer y registrar la traza de toda operación de escritura.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * DECISIÓN DA-09. La auditoría se escribe DENTRO de la misma transacción que la
 * operación auditada. Por eso `registrar` recibe el cliente de la transacción: una
 * evidencia que puede perderse ante un fallo parcial no sirve como evidencia, y la
 * evidencia es justamente el propósito de esta funcionalidad. El Product Owner
 * declaró que hoy la responsabilidad recae siempre sobre quien consolida, sin forma
 * de demostrar quién cambió qué.
 *
 * POR QUÉ NO ES UN INTERCEPTOR. Un interceptor se ejecuta fuera de la transacción
 * que el servicio abre después, de modo que no puede participar en ella. La única
 * manera de que lo hiciera sería que el interceptor abriese la transacción de toda
 * petición y la pasara hacia abajo, lo que obligaría a transaccionar también las
 * lecturas y a que cada servicio usara un cliente inyectado. Se descartó: contradice
 * «toda escritura multitabla en $transaction» del propio servicio. Ver el apartado
 * §3 de M04_NUCLEO_TRANSVERSAL.md.
 */

import { Injectable } from '@nestjs/common';
import type { AccionAuditoria, RolDepartamental } from '@prisma/client';

import { obtenerContexto } from '../contexto/contexto-peticion';
import {
  AuditoriaRepository,
  type ClientePrisma,
} from './auditoria.repository';

/** Cambio de un campo concreto, para las modificaciones. */
export interface CambioCampo {
  campo: string;
  valorAnterior?: string;
  valorNuevo?: string;
}

export interface DatosAuditoria {
  entidad: string;
  entidadId: number;
  accion: AccionAuditoria;
  /** Operativo al que pertenece la traza, cuando aplica. */
  operativoId?: number;
  /** Detalle campo a campo. Solo en modificaciones. */
  cambios?: CambioCampo[];
  /** Se toman del contexto si no se indican. */
  usuario?: number;
  rol?: RolDepartamental;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly repositorio: AuditoriaRepository) {}

  /**
   * Registra la traza de una operación de escritura.
   *
   * @param datos qué se hizo y sobre qué
   * @param cliente **el cliente de la transacción en curso**. Omitirlo escribe
   *                fuera de ella y rompe la garantía de DA-09.
   */
  async registrar(
    datos: DatosAuditoria,
    cliente?: ClientePrisma,
  ): Promise<void> {
    const filas = filasDe(datos);
    if (filas.length === 1 && !datos.cambios?.length) {
      await this.repositorio.insertar(filas[0], cliente);
      return;
    }
    await this.repositorio.insertarVarias(filas, cliente);
  }

  /**
   * Registra VARIAS trazas en UNA sola inserción (2026-10-14). Para las escrituras que tocan
   * muchas filas a la vez —la confirmación del optimizador asigna decenas de tramos—: una traza
   * por fila tocada, sin una consulta por fila. Misma garantía de DA-09: recibe el cliente de la
   * transacción en curso.
   */
  async registrarVarios(
    lista: readonly DatosAuditoria[],
    cliente?: ClientePrisma,
  ): Promise<void> {
    await this.repositorio.insertarVarias(lista.flatMap(filasDe), cliente);
  }

  /**
   * Compara dos versiones de un registro y devuelve solo los campos que cambiaron.
   * Evita que cada servicio repita esa comparación. RF-062.
   */
  compararCambios(
    anterior: Record<string, unknown>,
    nuevo: Record<string, unknown>,
  ): CambioCampo[] {
    const cambios: CambioCampo[] = [];
    for (const [campo, valorNuevo] of Object.entries(nuevo)) {
      const valorAnterior = anterior[campo];
      if (comoTexto(valorAnterior) === comoTexto(valorNuevo)) continue;
      cambios.push({
        campo,
        valorAnterior: comoTexto(valorAnterior),
        valorNuevo: comoTexto(valorNuevo),
      });
    }
    return cambios;
  }
}

/**
 * Las filas de `t_auditoria` de una traza: una por campo cambiado, o una sola si no hay detalle.
 * La identidad y la correlación salen del contexto de la petición si no se indican.
 */
function filasDe(datos: DatosAuditoria) {
  const contexto = obtenerContexto();
  const usuario = datos.usuario ?? contexto?.usuarioId;
  const rol = datos.rol ?? contexto?.rol;

  if (usuario === undefined || rol === undefined) {
    // Sin identidad no hay evidencia útil: una traza anónima no dice quién cambió
    // qué, que es lo único que esta funcionalidad debe garantizar.
    throw new Error(
      'No se puede auditar sin identidad resuelta. Verifique que IdentidadGuard se ejecutó antes.',
    );
  }

  const base = {
    entidad: datos.entidad,
    entidadId: datos.entidadId,
    accion: datos.accion,
    operativoId: datos.operativoId,
    usuario,
    rol,
    correlacion: contexto?.correlacionId,
  };

  return datos.cambios && datos.cambios.length > 0
    ? datos.cambios.map((cambio) => ({ ...base, ...cambio }))
    : [base];
}

/** Representación textual estable para comparar y almacenar. */
function comoTexto(valor: unknown): string | undefined {
  if (valor === undefined || valor === null) return undefined;
  if (valor instanceof Date) return valor.toISOString();
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') {
    return String(valor);
  }
  if (typeof valor === 'bigint') return valor.toString();
  return JSON.stringify(valor);
}
