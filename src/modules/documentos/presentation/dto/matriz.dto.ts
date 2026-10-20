/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Matriz consolidada
 * Archivo: matriz.dto.ts
 * Responsabilidad: Componer la respuesta de la matriz consolidada.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * LOS COLORES VIAJAN EN EL JSON. Es el caso 6 del plan y una regla del proyecto: el
 * frontend **no los define ni los interpreta**, los pinta. Son dato institucional del
 * Excel aprobado (FASE5 §10.2), y tenerlos en el cliente significaría que cambiar el
 * color de un formulario exige desplegar la interfaz.
 *
 * LAS ALERTAS TAMBIÉN. Vienen calculadas por POL-06 y guardadas en `oper_alertas`; la
 * matriz las transporta tal cual. Un segundo cálculo en el navegador podría discrepar del
 * que ve el departamento en su propia pantalla.
 */

import type { EstadoCuadro, EstadoTransporte } from '@prisma/client';
import { PoliticaVehiculo } from '@prisma/client';

import {
  notasDeOperativo,
  type NotaOperativo,
} from '../../../../common/notas/notas-operativo';
import type { Alerta } from '../../../operativos/application/politicas/alertas-operativo';
import type { MatrizCompuesta } from '../../application/matriz-consolidada.service';
import { textoDeTipoControl } from '../../application/tipo-control-texto';
import type { OperativoDeMatriz } from '../../infrastructure/matriz.repository';
import { comoHoraInstitucional } from '../../application/reglas-matriz';

/** Una fila de la matriz: las nueve columnas más observaciones. */
export interface FilaMatrizDto {
  id: number;
  identificador: string;
  /** Lote del registro-patrulla (Form 5/6): agrupa los N en la matriz. Nulo en el resto. */
  grupoRegistro: string | null;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * DE QUÉ OPERATIVO NACE, SI ES UN ADICIONAL. Agregado el 2026-08-20.
   *
   * AMPLÍA UN DOCUMENTO APROBADO, y por eso vale la pena decir por qué. La matriz se
   * firma y se distribuye, y desde que la Dirección puede sumar un adicional a un cuadro
   * ya cerrado, **existen dos versiones del mismo documento**. Quien compare la de las
   * 16H00 con la de las 18H00 tiene que ver qué se añadió y de dónde salió.
   *
   * El prefijo `OCAPMO` ya lo delata a quien lo conozca; esto lo dice con palabras, que
   * es lo que exige la regla 6: ninguna información depende de un detalle que hay que
   * saber interpretar.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  esAdicional: boolean;
  /** Identificador del operativo del que nace. Nulo en un operativo ordinario. */
  origen: string | null;
  horario: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CON TELÉFONO DESDE EL 2026-08-27, y no es un capricho de pantalla.
   *
   * `FASE2 §16.1` verifica contra la Hoja2 del Excel que la columna 3 del cuadro es
   * **PERSONAL ASIGNADO / TELÉFONO**, y RF-015 lo pide con prioridad alta: «recuperar el
   * teléfono desde el maestro sin permitir su edición». HU-07 explica para qué —a un
   * funcionario lo llamaron un domingo por un operativo que no era el suyo—.
   *
   * NO CUESTA NI UNA CONSULTA: `matriz.repository` ya carga `funcionario: true` entero.
   *
   * SALE DEL MAESTRO EN CADA LECTURA, no de una copia guardada en la asignación. Es
   * RN-34: un teléfono corregido en P-07 tiene que corregirse en el cuadro, y una copia
   * en `t_asignacion_personal` dejaría el número viejo en la fila para siempre.
   *
   * `null` ES UN CASO REAL, no teórico: hay fichas del maestro sin teléfono. La pantalla
   * lo dice con palabras; aquí viaja tal cual, sin inventar un guion.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  personal: {
    funcionarioId: number;
    nombre: string;
    telefono: string | null;
    esResponsable: boolean;
    /**
     * Horario EFECTIVO de la persona (2026-09-08): su ventana propia si la tiene, o la del
     * operativo. Permite que la fila muestre turnos distintos para quienes comparten operativo.
     */
    horaInicio: string;
    horaFin: string;
  }[];
  zonales: string[];
  puntoEncuentro: string;
  tipoControl: string;
  instituciones: string[];
  conductor: string | null;
  placa: string | null;
  /** Notas del operativo (bitácora, 2026-09-09): los textos, en orden. La matriz las pinta separadas. */
  observaciones: string[];
  /**
   * Las notas de la celda Observaciones (2026-10-19, plan «notas-jornada-matriz»): la bitácora con
   * su autor y la tarjeta COMPARTIDA, la más reciente primero. La Dirección ve el día entero, así
   * que la COMPARTIDA va siempre completa.
   */
  notas: NotaOperativo[];
  estadoTransporte: EstadoTransporte;
  esNocturno: boolean;
  /** POL-06. Por celda: la pantalla sabe cuál marcar en Amarillo de Alerta. */
  alertas: Alerta[];
}

export interface SeccionMatrizDto {
  numero: number;
  codigo: string;
  nombre: string;
  /** Caso 6 del plan: el color viene del servidor. */
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  responsable: string;
  esPatrulla: boolean;
  /**
   * RN-61. Si este formulario admite operativos adicionales. Desde el 2026-08-24.
   *
   * Lo dice el dato, no el código: el formulario los admite si tiene un prefijo marcado
   * con `fpre_es_adicional`, y hoy lo tiene **uno solo**, `OCAPMO` del 2 · PMO.
   *
   * P-05 lo necesita porque **ofrecía «Adicional» en los nueve formularios** y el
   * servidor lo rechazaba en ocho al pulsarlo. Sus filas nacen de esta matriz, no del
   * contrato de operativo, así que el dato tiene que viajar también por aquí.
   */
  admiteAdicionales: boolean;
  totalOperativos: number;
  filas: FilaMatrizDto[];
  /** RN-53 y RN-54. Presente solo si el formulario quedó vacío y su ventana venció. */
  evidencia: {
    leyenda: string;
    responsable: string;
    horaCierre: string | null;
  } | null;
}

export interface MatrizResponseDto {
  cabecera: {
    ordenTrabajo: string;
    fecha: string;
    fechaNatural: string;
    nroSemana: number;
    anioSemana: number;
    estado: EstadoCuadro;
    totalOperativos: number;
    totalAlertas: number;
    formulariosSinCarga: number;
    /** Indicador de flota de M-18. `null` mientras la DAF no declare. */
    flota: {
      declarados: number;
      requeridos: number;
      hayAdvertencia: boolean;
    } | null;
  };
  secciones: SeccionMatrizDto[];
}

export function aMatrizResponse(matriz: MatrizCompuesta): MatrizResponseDto {
  return {
    cabecera: {
      ordenTrabajo: matriz.cuadro.ordenTrabajo,
      fecha: matriz.cuadro.fecha.toISOString().slice(0, 10),
      fechaNatural: matriz.fechaNatural,
      nroSemana: matriz.cuadro.nroSemana,
      anioSemana: matriz.cuadro.anioSemana,
      estado: matriz.cuadro.estado,
      totalOperativos: matriz.totales.operativos,
      totalAlertas: matriz.totales.alertas,
      formulariosSinCarga: matriz.totales.formulariosSinCarga,
      flota: matriz.flota,
    },
    secciones: matriz.secciones.map((seccion) => ({
      numero: seccion.formulario.numero,
      codigo: seccion.formulario.codigo,
      nombre: seccion.formulario.nombre,
      colorFondo: seccion.formulario.colorFondo,
      colorAcento: seccion.formulario.colorAcento,
      colorNombre: seccion.formulario.colorNombre,
      responsable: seccion.responsable,
      esPatrulla: seccion.formulario.esPatrulla,
      admiteAdicionales: seccion.formulario.prefijos.some(
        (prefijo) => prefijo.esAdicional,
      ),
      totalOperativos: seccion.operativos.length,
      filas: seccion.operativos.map(aFilaMatriz),
      evidencia: seccion.evidencia,
    })),
  };
}

function aFilaMatriz(operativo: OperativoDeMatriz): FilaMatrizDto {
  return {
    id: operativo.id,
    identificador: operativo.identificador,
    grupoRegistro: operativo.grupoRegistro,
    // Se deriva de `origenId`, que es la columna, y no de la relación cargada: los dos
    // dicen lo mismo, pero la columna es la fuente y la relación su reflejo.
    esAdicional: operativo.origenId !== null,
    origen: operativo.origen?.identificador ?? null,
    horario: `${comoHoraInstitucional(operativo.horaInicio)} A ${comoHoraInstitucional(operativo.horaFin)}`,
    personal: operativo.personal.map((fila) => ({
      funcionarioId: fila.funcionarioId,
      nombre: `${fila.funcionario.apellidos} ${fila.funcionario.nombres}`,
      telefono: fila.funcionario.telefono,
      esResponsable: fila.esResponsable,
      horaInicio: fila.horaInicio ?? operativo.horaInicio,
      horaFin: fila.horaFin ?? operativo.horaFin,
    })),
    zonales: operativo.zonales.map((fila) => fila.zonal.nombre),
    puntoEncuentro:
      operativo.puntoEncuentro?.nombre ?? operativo.puntoLibre ?? '',
    tipoControl: textoDeTipoControl(operativo),
    instituciones: operativo.instituciones.map(
      (fila) => fila.institucion.sigla,
    ),
    // RN-41 y RN-42. Un formulario `NO_APLICA` opera por PROPIOS MEDIOS: no lleva conductor ni
    // placa por definición. Se dice con palabras, como en P-02: «Propios medios» / «No se activa»,
    // en vez de dejar la celda en blanco. Solo cuando no hay conductor/placa asignados.
    conductor:
      operativo.conductor?.nombreCompleto ??
      (operativo.formulario.politicaVehiculo === PoliticaVehiculo.NO_APLICA
        ? 'Propios medios'
        : null),
    placa:
      operativo.vehiculo?.placa ??
      (operativo.formulario.politicaVehiculo === PoliticaVehiculo.NO_APLICA
        ? 'No se activa'
        : null),
    observaciones: operativo.observaciones.map((nota) => nota.texto),
    notas: notasDeOperativo(operativo, operativo.autores ?? {}),
    estadoTransporte: operativo.estadoTransporte,
    esNocturno: operativo.esNocturno,
    alertas: (operativo.alertas as unknown as Alerta[] | null) ?? [],
  };
}
