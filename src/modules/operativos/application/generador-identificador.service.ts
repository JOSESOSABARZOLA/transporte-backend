/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: generador-identificador.service.ts
 * Responsabilidad: Elegir el prefijo del formulario y componer el identificador.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * POL-04. RN-09 a RN-12. El identificador se genera, nunca se digita: nació de que el
 * Product Owner se equivocaba «en el año y en el secuencial» al escribirlo a mano.
 *
 * ESTE SERVICIO NO DECIDE EL SECUENCIAL. Lo recibe. RN-12 exige que reinicie cada día
 * y que dos registros simultáneos no colisionen, y eso solo lo garantiza la base dentro
 * de una transacción (VAL-32): el conteo y la inserción tienen que ocurrir juntos, y
 * eso pertenece al repositorio. Aquí se elige el prefijo y se compone el código.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PV-27 · QUÉ PREFIJO SE ELIGE CUANDO EL FORMULARIO TIENE VARIOS.
 *
 * `t_formulario_prefijo` admite un prefijo por área. Dos criterios conviven, y cada uno se
 * decide por el DATO de la fila, no por un `if` con el número del formulario:
 *
 *   · Si el prefijo trae `areaAplica` —el 8: `IG`/`IGA` para GENERAL, `IT`/`ITA` para TECNICO
 *     (2026-09-08); el 5: `IGECU`/`ITECU`; y el 6: `IGNECU` (GENERAL), `ITNECU` (TECNICO) e
 *     `INECU` (INSTRUCCION) (2026-09-09)— se elige por el ÁREA del personal asignado. Hoy el
 *     personal se conoce ANTES de componer el identificador (se verifica en la misma
 *     transacción del registro), así que el criterio ya se puede aplicar. Un operativo
 *     corresponde a UNA sola área; si el personal mezcla varias, se detiene y lo dice.
 *   · Si no la trae, rige lo anterior: el marcado como predeterminado (el PMO usa OCPMO), o
 *     el único; y si hay varios y ninguno es predeterminado, se detiene nombrando el
 *     formulario, porque elegir por orden alfabético daría un código que no significa lo
 *     que aparenta.
 *
 * En el 6, `INECU` (INSTRUCCION) YA NO ES INERTE (2026-09-17): el DMIT APORTA su persona de
 * Instrucción y ese aporte CREA un operativo propio de UNA persona con `INECU`, enlazado a la
 * misma patrulla (`grupoRegistro`) que registró el DMIP. Ver la rama de formularios
 * `variosPorPersona` en `asignarPersonal`. El dueño DMIP sigue con General→`IGNECU` y
 * Técnico→`ITNECU`. La numeración es POR PREFIJO (cada serie desde 001).
 *
 * PV-27 SIGUE ABIERTO PARA EL FORMULARIO 7: su prefijo aún no trae `areaAplica` ni
 * predeterminado, así que registrar en él se detiene con el aviso hasta que el negocio defina
 * su criterio (como se hizo con el 8, el 5, el 6 y el PMO).
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * 2026-08-20 · EL ADICIONAL SE NOMBRA CON SU PROPIO PREFIJO.
 *
 * Un adicional del PMO no es `OCPMO-007`: es `OCAPMO-001`. Lleva prefijo distinto y
 * **serie propia**, de modo que el primer adicional del día es el 001 aunque el
 * formulario lleve seis operativos ordinarios. Los dos códigos no se confunden porque el
 * prefijo los separa, y `uq_operativo_cuad_ident` sigue garantizando que ninguno se
 * repita dentro de la jornada.
 *
 * QUÉ PREFIJO ES EL DEL ADICIONAL LO DICE LA FILA, con `fpre_es_adicional`. No se deduce
 * del texto: la A de `OCAPMO` significa «adicional», pero la I de `IG` e `IT` significa
 * otra cosa, y una regla que acierta por casualidad en un caso y falla en el otro no es
 * una regla.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { Injectable } from '@nestjs/common';
import type { AreaPersonal, FormularioPrefijo } from '@prisma/client';

import { ValidacionError } from '../../../common/errors/errores-dominio';
import { FormulariosService } from '../../configuracion/application/formularios.service';
import { IdentificadorOperativo } from '../domain/identificador-operativo';

@Injectable()
export class GeneradorIdentificadorService {
  constructor(private readonly formularios: FormulariosService) {}

  /**
   * Compone el identificador de un operativo.
   *
   * @param formulario identificador y nombre, para elegir el prefijo y redactar el error
   * @param secuencial número dentro de la jornada, que el repositorio obtuvo en la transacción
   * @param fechaJornada día del operativo en UTC, tal como se guarda en `cuad_fecha`
   * @param esAdicional si el operativo nace como adicional de otro
   */
  async generar(
    formulario: { id: number; nombre: string },
    secuencial: number,
    fechaJornada: Date,
    esAdicional = false,
    areas: AreaPersonal[] = [],
  ): Promise<string> {
    const prefijo = await this.resolverPrefijo(formulario, esAdicional, areas);
    return this.componer(prefijo, secuencial, fechaJornada);
  }

  /**
   * Elige el PREFIJO del operativo (por área si el formulario lo delimita), sin componer el
   * código. Se expone aparte para poder contar el secuencial POR PREFIJO antes de componer:
   * las patrullas (5/6) numeran cada prefijo desde 001, así que hay que conocer el prefijo
   * primero. Ver `registrarConSecuencial` y la rama de aporte de `asignarPersonal`.
   */
  async resolverPrefijo(
    formulario: { id: number; nombre: string },
    esAdicional: boolean,
    areas: AreaPersonal[],
  ): Promise<string> {
    const prefijos = await this.formularios.obtenerPrefijos(formulario.id);
    return esAdicional
      ? elegirPrefijoDeAdicional(prefijos, formulario.nombre, areas)
      : elegirPrefijo(prefijos, formulario.nombre, areas);
  }

  /** Compone `PREFIJO-NNN-DD-MMM-AAAA` con la fecha ya llevada a calendario local (Quito). */
  componer(prefijo: string, secuencial: number, fechaJornada: Date): string {
    return IdentificadorOperativo.componer(
      prefijo,
      secuencial,
      comoFechaDeCalendario(fechaJornada),
    ).toString();
  }

  /**
   * Comprueba que el formulario admita adicionales, **antes de validar nada más**.
   *
   * Se expone aparte porque el orden de las comprobaciones importa (§11.1 de la guía):
   * sin esto, quien intentara colgar un adicional de un formulario que no los contempla
   * recibiría primero los rechazos de sus catálogos o de su personal, y descubriría el
   * verdadero motivo al final. El mensaje habría sido correcto y la explicación, tardía.
   *
   * Que `generar` vuelva a resolverlo después no es una duplicación ociosa: es la
   * invariante del identificador, y vive donde el identificador se compone.
   */
  async exigirQueAdmitaAdicionales(formulario: {
    id: number;
    nombre: string;
  }): Promise<void> {
    // Solo comprueba que EXISTA un prefijo de adicional; todavía no elige entre ellos,
    // porque el personal —y con él el área que decide entre IGA e ITA— no se conoce aún.
    prefijosDeAdicional(
      await this.formularios.obtenerPrefijos(formulario.id),
      formulario.nombre,
    );
  }
}

/**
 * PV-27, RESUELTO para el 8 el 2026-09-08 y para el 5 y el 6 el 2026-09-09. Ver la cabecera.
 *
 * Cuando los prefijos ordinarios traen `areaAplica` —el 8 (IG/IT), el 5 (IGECU/ITECU) y el 6
 * (IGNECU/ITNECU/INECU)— se elige por el ÁREA del personal asignado, que ya se conoce al
 * componer el identificador. Cuando no la traen (el 7 y los demás), rige el criterio anterior:
 * el predeterminado, el único, o el aviso de «varios y ninguno predeterminado».
 */
function elegirPrefijo(
  prefijos: FormularioPrefijo[],
  nombreFormulario: string,
  areas: AreaPersonal[],
): string {
  // Los de adicional no compiten por el puesto de prefijo ordinario: sin apartarlos, el
  // PMO volvería a tener «varios y ninguno predeterminado» en cuanto se le quitara la
  // marca a OCPMO, y el mensaje culparía a una configuración que sí es correcta.
  const ordinarios = prefijos.filter((prefijo) => !prefijo.esAdicional);

  if (ordinarios.length === 0) {
    throw new ValidacionError(
      `El formulario ${nombreFormulario} no tiene configurado ningún prefijo de identificador. Comuníquelo al administrador del sistema.`,
      { nombreFormulario },
    );
  }

  if (ordinarios.some((prefijo) => prefijo.areaAplica !== null)) {
    return elegirPorArea(ordinarios, nombreFormulario, areas);
  }

  const predeterminado = ordinarios.find((prefijo) => prefijo.esPredeterminado);
  if (predeterminado) return predeterminado.prefijo;

  if (ordinarios.length === 1) return ordinarios[0].prefijo;

  throw new ValidacionError(
    `El formulario ${nombreFormulario} tiene varios prefijos de identificador y ninguno está marcado como predeterminado. Comuníquelo al administrador del sistema.`,
    { nombreFormulario, prefijos: ordinarios.map((fila) => fila.prefijo) },
  );
}

/**
 * El prefijo con el que se nombran los adicionales del formulario.
 *
 * NO HAY VALOR DE RESPALDO. Si el formulario no declara ninguno, esto se detiene en
 * lugar de reutilizar el ordinario: un adicional nombrado `OCPMO` sería indistinguible
 * de un operativo planificado en la matriz y en la orden de servicio, que es justo la
 * diferencia que el negocio pidió poder ver.
 *
 * Y ELIGE POR ÁREA cuando los prefijos de adicional la traen (el 8: IGA/ITA), igual que el
 * ordinario. Cuando no (el PMO: OCAPMO), rige que haya exactamente uno.
 */
function elegirPrefijoDeAdicional(
  prefijos: FormularioPrefijo[],
  nombreFormulario: string,
  areas: AreaPersonal[],
): string {
  const deAdicional = prefijosDeAdicional(prefijos, nombreFormulario);

  if (deAdicional.some((prefijo) => prefijo.areaAplica !== null)) {
    return elegirPorArea(deAdicional, nombreFormulario, areas);
  }

  if (deAdicional.length > 1) {
    throw new ValidacionError(
      `El formulario ${nombreFormulario} tiene más de un prefijo marcado para adicionales y no se puede saber cuál corresponde. Comuníquelo al administrador del sistema.`,
      { nombreFormulario, prefijos: deAdicional.map((fila) => fila.prefijo) },
    );
  }

  return deAdicional[0].prefijo;
}

/** Los prefijos de adicional del formulario, o un aviso si no tiene ninguno. */
function prefijosDeAdicional(
  prefijos: FormularioPrefijo[],
  nombreFormulario: string,
): FormularioPrefijo[] {
  const deAdicional = prefijos.filter((prefijo) => prefijo.esAdicional);
  if (deAdicional.length === 0) {
    throw new ValidacionError(
      `El formulario ${nombreFormulario} no admite operativos adicionales: no tiene configurado un prefijo para ellos. Comuníquelo al administrador del sistema.`,
      { nombreFormulario },
    );
  }
  return deAdicional;
}

/**
 * Elige entre prefijos delimitados por área (el formulario 8) según el área del personal.
 * Un operativo corresponde a UNA sola área: si el personal mezcla varias se detiene, porque
 * el prefijo —IG frente a IT— nombra el tipo de inspector y uno mezclado no significaría nada.
 */
function elegirPorArea(
  candidatos: FormularioPrefijo[],
  nombreFormulario: string,
  areas: AreaPersonal[],
): string {
  const distintas = [...new Set(areas)];

  if (distintas.length === 0) {
    throw new ValidacionError(
      `El formulario ${nombreFormulario} elige el prefijo del identificador según el área del personal, y este operativo no tiene personal que la defina. Comuníquelo al administrador del sistema.`,
      { nombreFormulario },
    );
  }

  if (distintas.length > 1) {
    throw new ValidacionError(
      `El operativo del formulario ${nombreFormulario} mezcla personal de áreas distintas; registre un operativo por área.`,
      { nombreFormulario, areas: distintas },
    );
  }

  const elegido = candidatos.find(
    (prefijo) => prefijo.areaAplica === distintas[0],
  );
  if (!elegido) {
    throw new ValidacionError(
      `El formulario ${nombreFormulario} no tiene un prefijo de identificador para el área del personal asignado. Comuníquelo al administrador del sistema.`,
      { nombreFormulario, area: distintas[0] },
    );
  }

  return elegido.prefijo;
}

/**
 * Traduce la fecha de calendario de la jornada a los componentes locales.
 *
 * `cuad_fecha` es `@db.Date` y se maneja en UTC en todo el sistema, pero
 * `IdentificadorOperativo` lee día, mes y año con los captadores locales —y su lector
 * `desde()` los interpreta igual—. En Quito, UTC-5, pasarle la fecha UTC directamente
 * imprimiría **el día anterior** en el código: `2026-08-05` saldría como `04-AGO-2026`,
 * y ese código va en la matriz y en las órdenes de servicio.
 *
 * La conversión vive aquí, en el borde, y no dentro del objeto de valor: cambiarlo a él
 * modificaría un módulo ya entregado y su lectura dejaría de ser simétrica.
 */
function comoFechaDeCalendario(fechaUtc: Date): Date {
  return new Date(
    fechaUtc.getUTCFullYear(),
    fechaUtc.getUTCMonth(),
    fechaUtc.getUTCDate(),
  );
}
