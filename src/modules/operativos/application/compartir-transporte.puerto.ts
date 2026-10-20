/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Registro del operativo · compartir unidad
 * Archivo: compartir-transporte.puerto.ts
 * Responsabilidad: Puerto por el que `operativos` pregunta a `transporte` si un operativo puede viajar
 *                  en la misma unidad que otro, sin depender de ese submódulo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-19
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * MISMO PATRÓN QUE `herencia-transporte.puerto.ts`, Y POR LA MISMA RAZÓN. `transporte` ya depende de
 * `operativos`; que `operativos` importara `TransporteModule` cerraría el ciclo. La compatibilidad
 * necesita lo que solo `transporte` sabe —cómo se parten los tramos de cada modalidad (sus
 * duraciones son parámetros DAF), la ventana COMPARTIR_VENTANA_MIN y el sector de cada zonal—, así
 * que `operativos` define QUÉ pregunta y `transporte` lo responde inscribiéndose al iniciar.
 *
 * SIN NADIE INSCRITO —una prueba que solo levanta `operativos`— todo se da por COMPATIBLE: la
 * sugerencia del registro no bloquea nada, y quien ejecuta el compartir (la DAF) vuelve a validar
 * con la flota a la vista. Es la ausencia del submódulo que decide, no un permiso.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { TipoTransporte } from '@prisma/client';

/** Un operativo visto para compartir unidad: lo que decide sus tramos y su exclusividad. */
export interface OperativoParaCompartir {
  horaInicio: string;
  horaFin: string;
  tipoTransporte: TipoTransporte;
  /** Primera zonal del operativo (la de sus tramos), o `null` si no tiene. */
  zonalId: number | null;
  esMacrooperativo: boolean;
  /** Para decir con quién va cada traslado («retirar con OCPMO-002»). */
  identificador?: string;
  /**
   * Quienes ya piden viajar en esta unidad (2026-10-19): con ellos, la unidad es la del GRUPO. Un
   * «solo retirar» viaja con el retiro de un «dejar y retirar» ya unido al «solo dejar» anfitrión.
   */
  miembros?: readonly OperativoParaCompartir[];
}

/** Con quién viaja un traslado del invitado: el tipo en una palabra y el operativo de la unidad. */
export interface TrasladoCompartido {
  tipo: string;
  con: string;
}

/**
 * El veredicto de un anfitrión (2026-10-19, «la misma unidad»): con qué traslados viajaría juntos
 * (`comparte`) y cuáles quedarían propios del invitado (`propios`), en una palabra cada uno
 * («dejar», «retirar», «todo el operativo»). Basta un traslado en común para ser compatible.
 */
export type VeredictoCompartir =
  | {
      compatible: true;
      comparte: string[];
      propios: string[];
      /** Detalle de `comparte`: con qué operativo de la unidad viaja cada traslado. */
      comparteCon?: TrasladoCompartido[];
      /**
       * «Completo» (2026-10-20): los traslados de la unidad que el «completo» del INVITADO abarca
       * (la unidad lo acompaña todo el día y además deja/retira a los otros), en una palabra.
       */
      contiene?: string[];
      /** El «completo» de la unidad dentro del que viajan los traslados del invitado, si lo hay. */
      contenidoEn?: string | null;
    }
  | { compatible: false; motivo: string };

/** Lo que `operativos` necesita de `transporte`. */
export interface CompatibilidadCompartir {
  /**
   * Un veredicto por anfitrión, en el mismo orden: ¿puede `invitado` viajar en su unidad? Sin
   * asientos (todavía no hay vehículo): es la coincidencia del registro.
   */
  evaluar(
    invitado: OperativoParaCompartir,
    anfitriones: readonly OperativoParaCompartir[],
  ): Promise<VeredictoCompartir[]>;
}

/** Registro donde `transporte` inscribe su implementación. Uno por aplicación. */
@Injectable()
export class RegistroCompatibilidadCompartir {
  private implementacion: CompatibilidadCompartir | null = null;

  registrar(implementacion: CompatibilidadCompartir): void {
    this.implementacion = implementacion;
  }

  /**
   * Evalúa con la implementación inscrita; sin ella, todos compatibles (ver la cabecera).
   */
  async evaluar(
    invitado: OperativoParaCompartir,
    anfitriones: readonly OperativoParaCompartir[],
  ): Promise<VeredictoCompartir[]> {
    if (!this.implementacion)
      return anfitriones.map(() => ({
        compatible: true,
        comparte: [],
        propios: [],
      }));
    return this.implementacion.evaluar(invitado, anfitriones);
  }
}
