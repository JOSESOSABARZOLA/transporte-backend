/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Jornada del día (P-13)
 * Archivo: jornada.dto.ts
 * Responsabilidad: Componer la respuesta de la jornada para un rol departamental.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-26
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * NO ES `matriz.dto.ts`, Y TIENE TRES CAMPOS MENOS QUE ÉL. A propósito.
 *
 * | Campo | Por qué no está |
 * |---|---|
 * | `flota` | El indicador de capacidad es de la DAF y de la Dirección. El DMIT no asigna transporte y no decide sobre él |
 * | `admiteAdicionales` | Lo consume P-05 para ofrecer «Adicional», y P-05 es de la Dirección. Esta pantalla no dispone adicionales |
 * | `esPatrulla` | La matriz tampoco lo usa hoy en pantalla. No se transporta lo que nadie lee |
 *
 * Y tiene uno que la matriz no necesita: **`acceso`** por sección.
 *
 * Lo que **no** se recorta es el contenido de las filas. El negocio decidió el 2026-08-26
 * que el DMIT vea la jornada completa, y recortar aquí columnas a medias daría una
 * pantalla que dice algo distinto de lo que se acordó. Si algún día se quiere redactar lo
 * ajeno, el sitio es este y el patrón está escrito en `dato-aislado.ts`: se construye lo
 * que se expone, no se filtra lo que no.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * LOS COLORES VIAJAN EN EL JSON, como en M-19: el frontend no los define ni los
 * interpreta, los pinta. Son dato institucional del Excel aprobado.
 */

import type {
  AreaPersonal,
  EstadoCuadro,
  EstadoTransporte,
} from '@prisma/client';
import { PoliticaVehiculo } from '@prisma/client';

import {
  notasDeOperativo,
  ocultarCompartidaAjena,
  type NotaOperativo,
} from '../../../../common/notas/notas-operativo';
import type { Alerta } from '../../../operativos/application/politicas/alertas-operativo';
import { estadoDeComposicion } from '../../../operativos/application/politicas/composicion-personal';
import { textoDeTipoControl } from '../../application/tipo-control-texto';
import type {
  AccesoSeccion,
  JornadaCompuesta,
  SeccionJornada,
} from '../../application/jornada.service';
import type { OperativoDeJornada } from '../../infrastructure/jornada.repository';
import { comoHoraInstitucional } from '../../application/reglas-matriz';

/** Una fila de la jornada. Mismas columnas que el documento del día. */
export interface FilaJornadaDto {
  id: number;
  identificador: string;
  /** Lote del registro-patrulla (Form 5/6): agrupa los N en la jornada. Nulo en el resto. */
  grupoRegistro: string | null;
  esAdicional: boolean;
  /** Identificador del operativo del que nace. Nulo en un operativo ordinario. */
  origen: string | null;
  horario: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * CON TELÉFONO DESDE EL 2026-08-27, igual que la matriz y el listado.
   *
   * Decía «lo justo para nombrarlo en la tabla, **sin `area` ni `telefono`**», y ese
   * recorte tenía sentido mientras la celda solo pintaba nombres unidos por comas. Al
   * agrupar la fila por persona el teléfono pasa a ser columna del cuadro —`FASE2 §16.1`,
   * RF-015, RN-34— y P-13 muestra los nueve formularios: recortarlo aquí dejaría al DMIT
   * mirando una columna vacía en las secciones ajenas.
   *
   * `area` SIGUE SIN VIAJAR, y esa parte del recorte se mantiene: para editar el personal
   * se pide `GET /operativos/:id`, igual que hace P-05 al abrir una fila.
   *
   * NO CUESTA NI UNA CONSULTA: `jornada.repository` ya carga `funcionario: true` entero.
   * ═══════════════════════════════════════════════════════════════════════════════
   *
   * ═══════════════════════════════════════════════════════════════════════════════
   * Y DESDE EL 2026-09-01 ESTA LISTA LLEGA VACÍA EN LAS SECCIONES DE SOLO LECTURA.
   *
   * El razonamiento de arriba —«recortarlo aquí dejaría al DMIT mirando una columna vacía
   * en las secciones ajenas»— se dio la vuelta al abrir la jornada a los tres roles
   * departamentales: **esa columna vacía pasó a ser justamente lo que se quiere**.
   *
   * Alcanza también al DMIT, y es deliberado: la regla es una —participo, veo; solo leo,
   * no— y hacerla depender de qué rol pregunta habría vuelto a meter un rol dentro de un
   * `if`. El DMIT pierde con ello el teléfono ajeno que ganó el 27-AGO; conserva entero
   * el de las secciones donde escribe o aporta, que es donde lo necesita.
   *
   * El vaciado NO ocurre aquí sino en `jornada.service.ts`: si el dato no sale del
   * servicio, un descuido futuro en este mapeo no puede publicarlo.
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
  /** Notas del operativo (bitácora, 2026-09-09): los textos, en orden. */
  observaciones: string[];
  /**
   * Las notas de la celda Observaciones (2026-10-19, plan «notas-jornada-matriz»): la bitácora con
   * su autor y la tarjeta COMPARTIDA, la más reciente primero. Misma forma que en P-01/P-02. Si el
   * anfitrión de la COMPARTIDA es de un formulario que este rol no ve, no se nombra (RN-48, J3).
   */
  notas: NotaOperativo[];
  estadoTransporte: EstadoTransporte;
  esNocturno: boolean;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * DE QUÉ ÁREAS ESPERA ESTE OPERATIVO PERSONAL **DE QUIEN CONSULTA**. Vacío si no
   * espera nada, y vacío siempre en una sección de solo lectura.
   *
   * Es lo que hace que P-13 avise sin que exista un subsistema de notificaciones: cuando
   * DMIP Operativos registra un operativo de la 4 · Patrulla ECU Diurna, el DMIT lo ve
   * aquí con `['INSTRUCCION']` y sabe que le toca poner a su gente.
   *
   * **NO ES `EstadoComposicion.areasPendientes`, aunque salga de él.** Aquella son las
   * áreas que le faltan al operativo, mire quien mire; esta es la parte de aquellas que
   * le corresponde a quien está mirando. En la 6 · Patrulla Reacción Nocturna un
   * operativo sin nadie tiene tres áreas pendientes y solo una es del DMIT.
   *
   * Se deriva en el servidor por el mismo motivo que las alertas (POL-06): un segundo
   * cálculo en el navegador podría discrepar del que aplica el servidor al asignar.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  areasPendientesDelRol: AreaPersonal[];
  /** POL-06. Por celda: la pantalla sabe cuál marcar en Amarillo de Alerta. */
  alertas: Alerta[];
}

export interface SeccionJornadaDto {
  numero: number;
  codigo: string;
  nombre: string;
  colorFondo: string;
  colorAcento: string;
  colorNombre: string;
  responsable: string;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * QUÉ PUEDE HACER AQUÍ QUIEN CONSULTA. Y VA POR SECCIÓN, NO POR FILA.
   *
   * Una fila no tiene un permiso propio: el personal se asigna en el formulario donde el
   * rol participa, y todas las filas de una sección pertenecen al mismo formulario.
   * Repetir el dato en cada fila daría **dos sitios donde consultarlo y dos que podrían
   * discrepar**, que es exactamente lo que este proyecto evita en el cálculo de duración,
   * en las alertas y en los colores.
   *
   * Lo que sí es por operativo —quién lo registró, y por tanto quién puede editarlo o
   * retirarlo— no viaja por aquí: esta pantalla solo toca personal, y para eso basta con
   * participar en el formulario.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  acceso: AccesoSeccion;
  /**
   * ═══════════════════════════════════════════════════════════════════════════════
   * SI ESTA PANTALLA OFRECE LA ACCIÓN DE PERSONAL. 2026-09-01.
   *
   * VIAJA APARTE DE `acceso` PORQUE NO SE DEDUCE DE ÉL. La pantalla lo daba por deducido
   * —ofrecía la acción donde el acceso no era `LECTURA`— y por eso los dos departamentos
   * a los que se abrió la jornada ese mismo día podían asignar desde aquí, cuando la
   * decisión del negocio decía «solo en lectura».
   *
   * Sale de `t_formulario_rol`, igual que `acceso`, así que el cliente no comprueba
   * ningún rol y conceder o retirar el camino es un `UPDATE`.
   * ═══════════════════════════════════════════════════════════════════════════════
   */
  puedeEditarPersonal: boolean;
  totalOperativos: number;
  filas: FilaJornadaDto[];
  /** RN-53 y RN-54. Presente solo si el formulario quedó vacío y su ventana venció. */
  evidencia: {
    leyenda: string;
    responsable: string;
    horaCierre: string | null;
  } | null;
}

export interface JornadaResponseDto {
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
  };
  secciones: SeccionJornadaDto[];
}

export function aJornadaResponse(
  jornada: JornadaCompuesta,
): JornadaResponseDto {
  // RN-48 (J3): los operativos que este rol ve. Una COMPARTIDA hacia uno de fuera no lo nombra.
  const visibles = new Set(
    jornada.secciones.flatMap((seccion) =>
      seccion.operativos.map((operativo) => operativo.id),
    ),
  );
  return {
    cabecera: {
      ordenTrabajo: jornada.cuadro.ordenTrabajo,
      fecha: jornada.cuadro.fecha.toISOString().slice(0, 10),
      fechaNatural: jornada.fechaNatural,
      nroSemana: jornada.cuadro.nroSemana,
      anioSemana: jornada.cuadro.anioSemana,
      estado: jornada.cuadro.estado,
      totalOperativos: jornada.totales.operativos,
      totalAlertas: jornada.totales.alertas,
      formulariosSinCarga: jornada.totales.formulariosSinCarga,
    },
    secciones: jornada.secciones.map((seccion) => ({
      numero: seccion.formulario.numero,
      codigo: seccion.formulario.codigo,
      nombre: seccion.formulario.nombre,
      colorFondo: seccion.formulario.colorFondo,
      colorAcento: seccion.formulario.colorAcento,
      colorNombre: seccion.formulario.colorNombre,
      responsable: seccion.responsable,
      acceso: seccion.acceso,
      puedeEditarPersonal: seccion.puedeEditarPersonal,
      totalOperativos: seccion.operativos.length,
      filas: seccion.operativos.map((operativo) =>
        aFilaJornada(operativo, seccion, visibles),
      ),
      evidencia: seccion.evidencia,
    })),
  };
}

function aFilaJornada(
  operativo: OperativoDeJornada,
  seccion: SeccionJornada,
  visibles: ReadonlySet<number>,
): FilaJornadaDto {
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
    // placa por definición, y la celda quedaba en blanco (indistinguible de «aún no asignado»). Se
    // dice con palabras, como en P-02: «Propios medios» / «No se activa». Solo cuando de verdad no
    // hay conductor/placa asignados; si la DAF ya los puso, se muestran.
    conductor:
      operativo.conductor?.nombreCompleto ??
      (seccion.formulario.politicaVehiculo === PoliticaVehiculo.NO_APLICA
        ? 'Propios medios'
        : null),
    placa:
      operativo.vehiculo?.placa ??
      (seccion.formulario.politicaVehiculo === PoliticaVehiculo.NO_APLICA
        ? 'No se activa'
        : null),
    observaciones: operativo.observaciones.map((nota) => nota.texto),
    notas: ocultarCompartidaAjena(
      notasDeOperativo(operativo, operativo.autores ?? {}),
      visibles,
    ),
    estadoTransporte: operativo.estadoTransporte,
    esNocturno: operativo.esNocturno,
    areasPendientesDelRol: areasPendientesDelRol(operativo, seccion),
    alertas: (operativo.alertas as unknown as Alerta[] | null) ?? [],
  };
}

/**
 * Qué le falta a este operativo **de lo que quien consulta puede poner**.
 *
 * Se apoya en `estadoDeComposicion`, que es donde vive la definición de «área pendiente»
 * (RN-31 y RN-32), y solo le recorta el alcance al rol. Escribir aquí un segundo recuento
 * daría dos sitios que podrían discrepar el día que cambie qué cuenta como presente.
 */
function areasPendientesDelRol(
  operativo: OperativoDeJornada,
  seccion: SeccionJornada,
): AreaPersonal[] {
  if (seccion.areasDelRol.length === 0) return [];

  const { formulario } = seccion;
  const { areasPendientes } = estadoDeComposicion(
    {
      nombre: formulario.nombre,
      rolDueno: formulario.rolDueno,
      roles: formulario.roles,
      esPatrulla: formulario.esPatrulla,
      areas: formulario.areas,
    },
    operativo.personal.map((fila) => ({
      funcionarioId: fila.funcionarioId,
      area: fila.funcionario.area,
      asignadoPorRol: fila.asignadoPorRol,
    })),
  );

  return areasPendientes.filter((area) => seccion.areasDelRol.includes(area));
}
