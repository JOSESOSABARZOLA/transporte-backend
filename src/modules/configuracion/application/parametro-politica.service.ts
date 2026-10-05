/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Parámetros de política
 * Archivo: parametro-politica.service.ts
 * Responsabilidad: Publicar los umbrales de política y gobernar su modificación.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * ES EL SERVICIO DEL QUE DEPENDEN LAS REGLAS QUE PROTEGEN A LAS PERSONAS.
 *
 * Las políticas de descanso LEEN de aquí; nunca escriben una constante literal. Por
 * decisión del Product Owner, el umbral de jornada y el período de cómputo del tope
 * de salidas son configurables, de modo que la Dirección los ajusta sin desplegar
 * código. Ver docs/IMPLEMENTATION_GUIDE.md §5.
 *
 * CACHÉ. Los valores se consultan en cada asignación de personal, así que se guardan
 * en memoria y se invalidan al modificarse. Una lectura que fuera a la base en cada
 * validación penalizaría la captura, que el negocio quiere en dos o tres minutos.
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, type ParametroPolitica } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import { ParametroPoliticaRepository } from '../infrastructure/parametro-politica.repository';
import { motivoDeRechazo } from './reglas-parametro';

@Injectable()
export class ParametroPoliticaService {
  /** Caché de clave a valor. Se invalida por completo ante cualquier modificación. */
  private cache: Map<string, string> | null = null;

  constructor(
    private readonly repositorio: ParametroPoliticaRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  async listar(): Promise<ParametroPolitica[]> {
    return this.repositorio.listar();
  }

  /**
   * Devuelve un parámetro por su clave.
   *
   * La clave viaja en la ruta e identifica al recurso, así que su ausencia es un 404
   * y no un 400: el cuerpo enviado no tiene nada de malo, lo que no existe es aquello
   * que se quiso consultar o modificar.
   */
  async obtener(clave: string): Promise<ParametroPolitica> {
    const parametro = await this.repositorio.buscarPorClave(clave);
    if (!parametro) {
      throw new RecursoNoEncontradoError(
        `No existe un parámetro de política con la clave ${clave}.`,
        { clave },
      );
    }
    return parametro;
  }

  // ─────────────────── Lectura tipada, para las políticas ───────────────────

  async obtenerEntero(clave: string): Promise<number> {
    const valor = Number(await this.obtenerTexto(clave));
    if (!Number.isInteger(valor)) {
      throw new ValidacionError(
        `El parámetro ${clave} no contiene un número entero.`,
      );
    }
    return valor;
  }

  async obtenerDecimal(clave: string): Promise<number> {
    const bruto = (await this.obtenerTexto(clave)).replace(',', '.');
    const valor = Number(bruto);
    if (Number.isNaN(valor)) {
      throw new ValidacionError(`El parámetro ${clave} no contiene un número.`);
    }
    return valor;
  }

  async obtenerTexto(clave: string): Promise<string> {
    const cache = await this.cargarCache();
    const valor = cache.get(clave);

    if (valor === undefined) {
      // Una política que lee un parámetro inexistente es un defecto. Devolver un
      // valor por defecto reintroduciría la constante literal que este servicio
      // existe para eliminar, y lo haría en silencio.
      throw new ValidacionError(
        `El parámetro de política ${clave} no está configurado.`,
      );
    }
    return valor;
  }

  /**
   * Lee un texto cuyo parámetro PUEDE no estar configurado todavía: devuelve `''` en vez de lanzar.
   *
   * A diferencia de `obtenerTexto`, aquí la ausencia NO es un defecto: hay datos —como el cargo o la
   * dependencia del firmante de la orden (F22)— cuyo «sin configurar» es un estado legítimo que el
   * negocio trata como dato faltante, no como error. El `ck_parametro_valor` de la base prohíbe
   * guardar un valor vacío, así que «sin configurar» se modela por AUSENCIA de la fila, no por fila
   * vacía: hasta que la Dirección fije un valor real, la clave no existe y aquí se lee como `''`.
   */
  async obtenerTextoOpcional(clave: string): Promise<string> {
    const cache = await this.cargarCache();
    return cache.get(clave) ?? '';
  }

  // ─────────────────────────── Modificación ───────────────────────────

  /**
   * Cambia el valor de un parámetro.
   *
   * La modificación y su traza se escriben en la MISMA transacción: una evidencia
   * que puede perderse ante un fallo parcial no sirve como evidencia (DA-09).
   */
  async actualizar(
    clave: string,
    valorNuevo: string,
    usuarioId: number,
  ): Promise<ParametroPolitica> {
    const parametro = await this.obtener(clave);
    const limpio = valorNuevo.trim();

    const motivo = motivoDeRechazo(parametro, limpio);
    if (motivo) {
      throw new ValidacionError(motivo, {
        clave,
        valorPropuesto: limpio,
        minimo: parametro.minimo,
        maximo: parametro.maximo,
      });
    }

    if (limpio === parametro.valor) {
      return parametro;
    }

    const actualizado = await this.repositorio.ejecutarEnTransaccion(
      async (cliente) => {
        const resultado = await this.repositorio.actualizarValor(
          clave,
          limpio,
          usuarioId,
          cliente,
        );

        await this.auditoria.registrar(
          {
            entidad: 't_parametro_politica',
            entidadId: parametro.id,
            accion: AccionAuditoria.ACTUALIZAR,
            cambios: [
              {
                campo: 'para_valor',
                valorAnterior: parametro.valor,
                valorNuevo: limpio,
              },
            ],
            usuario: usuarioId,
          },
          cliente,
        );

        return resultado;
      },
    );

    this.invalidarCache();
    this.logger.log('Parámetro de política modificado', {
      clave,
      valorAnterior: parametro.valor,
      valorNuevo: limpio,
    });

    return actualizado;
  }

  /** Descarta la caché. La siguiente lectura vuelve a la base. */
  invalidarCache(): void {
    this.cache = null;
  }

  private async cargarCache(): Promise<Map<string, string>> {
    if (this.cache) return this.cache;

    const parametros = await this.repositorio.listar();
    this.cache = new Map(
      parametros.map((parametro) => [parametro.clave, parametro.valor]),
    );
    return this.cache;
  }
}
