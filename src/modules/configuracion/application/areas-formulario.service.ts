/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: areas-formulario.service.ts
 * Responsabilidad: Cambiar qué áreas de personal admite un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-27
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HASTA HOY ESTO SOLO CAMBIABA POR MIGRACIÓN.
 *
 * `t_formulario_area` existe desde el esquema inicial y gobierna una regla que se aplica
 * en dos sitios —`GET /personal/elegible` filtra por ella en SQL, y `reglaAreaAdmitida`
 * la vuelve a comprobar al asignar— pero **no había una sola línea de código que la
 * escribiera**: el reparto de los nueve formularios venía de la semilla y cada ajuste
 * exigía un despliegue.
 *
 * Este servicio es esa escritura, y nada más. No cambia ninguna regla: cambia el dato
 * sobre el que las reglas de siempre operan.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DOS PUERTAS, Y LAS DOS RECHAZAN EN LUGAR DE AVISAR.
 *
 * 1 · UN FORMULARIO NO SE QUEDA SIN ÁREAS. `personal-elegible.service.ts` devuelve lista
 *     vacía cuando no hay ninguna declarada, así que el formulario quedaría inservible
 *     **sin decir por qué**: el operador vería un selector de personal vacío y ningún
 *     mensaje. Es el peor de los fallos posibles aquí, porque no parece un fallo.
 *
 * 2 · NO SE RETIRA UN ÁREA QUE YA TIENE GENTE ASIGNADA en la jornada viva, y el rechazo
 *     **nombra los operativos**. Admitirlo dejaría asignaciones en pie amparadas por una
 *     regla que acaba de dejar de existir: nadie las vería mal hasta que alguien
 *     intentara reasignar y el servidor las rechazara.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import { AccionAuditoria, type AreaPersonal } from '@prisma/client';

import { AuditoriaService } from '../../../common/auditoria/auditoria.service';
import {
  RecursoNoEncontradoError,
  ValidacionError,
} from '../../../common/errors/errores-dominio';
import { LoggerService } from '../../../common/logger/logger.service';
import {
  FormulariosRepository,
  type FormularioConAreas,
} from '../infrastructure/formularios.repository';

@Injectable()
export class AreasFormularioService {
  constructor(
    private readonly repositorio: FormulariosRepository,
    private readonly auditoria: AuditoriaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Deja el formulario con exactamente esas áreas.
   *
   * Se recibe **el conjunto entero**, no una operación de alta o de baja. Con altas y
   * bajas sueltas existe el instante en que el formulario se queda sin ninguna, y ese
   * instante es exactamente lo que la primera puerta impide.
   */
  async reemplazar(
    codigo: string,
    areas: AreaPersonal[],
    usuarioId: number,
  ): Promise<FormularioConAreas> {
    const formulario = await this.exigirFormulario(codigo);

    // Se ordena y se quitan repetidos: el cliente manda una lista y la clave primaria de
    // la tabla es `(form_id, área)`, así que un repetido sería un error de inserción con
    // un mensaje de base de datos en lugar de uno legible.
    const pedidas = [...new Set(areas)];

    this.exigirAlgunaArea(formulario, pedidas);
    await this.exigirQueNadieQuedeDescolgado(formulario, pedidas);

    const antes = formulario.areas.map((fila) => fila.area).sort();

    await this.repositorio.ejecutarEnTransaccion(async (cliente) => {
      await this.repositorio.igualarAreas(formulario.id, pedidas, cliente);

      await this.auditoria.registrar(
        {
          entidad: 't_formulario_area',
          entidadId: formulario.id,
          accion: AccionAuditoria.ACTUALIZAR,
          cambios: [
            {
              campo: 'farea_area',
              valorAnterior: antes.join(', '),
              valorNuevo: [...pedidas].sort().join(', '),
            },
          ],
          usuario: usuarioId,
        },
        cliente,
      );
    });

    this.logger.log('Áreas de formulario actualizadas', {
      formulario: formulario.codigo,
      antes,
      ahora: [...pedidas].sort(),
    });

    return this.exigirFormulario(codigo);
  }

  // ─────────────────────────── Puertas ───────────────────────────

  private exigirAlgunaArea(
    formulario: FormularioConAreas,
    areas: AreaPersonal[],
  ): void {
    if (areas.length > 0) return;

    throw new ValidacionError(
      `El formulario ${formulario.nombre} tiene que admitir al menos un área: sin ninguna, su selector de personal queda vacío y no lo explica.`,
      { formulario: formulario.codigo },
    );
  }

  /**
   * RN-15 y VAL-10, mirando hacia atrás.
   *
   * Las que se retiran son las que estaban y ya no van a estar. Si alguna tiene personal
   * asignado en un cuadro que todavía admite cambios, se rechaza el conjunto entero
   * —no se aplica «lo que se pueda»— y se dicen los operativos, para que se puedan
   * arreglar y volver a intentarlo.
   */
  private async exigirQueNadieQuedeDescolgado(
    formulario: FormularioConAreas,
    pedidas: AreaPersonal[],
  ): Promise<void> {
    const retiradas = formulario.areas
      .map((fila) => fila.area)
      .filter((area) => !pedidas.includes(area));

    if (retiradas.length === 0) return;

    const estorban = await this.repositorio.asignacionesEnAreas(
      formulario.id,
      retiradas,
    );

    if (estorban.length === 0) return;

    // Un operativo puede tener varias personas del área: se nombra una vez cada uno.
    const operativos = [...new Set(estorban.map((fila) => fila.identificador))];
    const areasEnUso = [...new Set(estorban.map((fila) => fila.area))];

    throw new ValidacionError(
      `No se puede retirar ${areasEnUso.join(', ')} de ${formulario.nombre}: hay personal de ${areasEnUso.length === 1 ? 'esa área' : 'esas áreas'} asignado en ${operativos.join(', ')}. Retire primero a esas personas del operativo.`,
      { formulario: formulario.codigo, areas: areasEnUso, operativos },
    );
  }

  private async exigirFormulario(codigo: string): Promise<FormularioConAreas> {
    const formulario = await this.repositorio.buscarPorCodigo(codigo);

    if (!formulario) {
      throw new RecursoNoEncontradoError(
        `No existe un formulario vigente con el código ${codigo}.`,
        { codigo },
      );
    }

    return formulario;
  }
}
