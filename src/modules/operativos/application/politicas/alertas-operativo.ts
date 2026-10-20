/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Asignación de personal y alertas
 * Archivo: alertas-operativo.ts
 * Responsabilidad: Derivar el conjunto de alertas del estado actual del operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POL-06. SE CALCULAN COMPLETAS, NUNCA DE FORMA INCREMENTAL.
 *
 * Esta función recibe el estado del operativo y devuelve **todas** sus alertas. No
 * recibe las anteriores, no las modifica y no sabe cuáles había: por construcción, no
 * puede dejar una alerta residual.
 *
 * Es el defecto que hoy tiene el cuadro en Excel y que el Product Owner describió: la
 * celda queda amarilla después de que el dato se completó, porque alguien tiene que
 * acordarse de quitarle el color. RN-55 dice que la alerta desaparece **automáticamente**
 * cuando la información se completa, y la única forma de garantizarlo es no llevar
 * estado: recalcular todo ante cualquier cambio.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ES UNA FUNCIÓN PURA. No consulta la base, no conoce NestJS y no lee parámetros: quien
 * la llama ya resolvió el estado. Así los casos se prueban sin levantar nada.
 */

import {
  EstadoTransporte,
  PoliticaVehiculo,
  TipoTransporte,
} from '@prisma/client';

/** Celda del cuadro que la alerta marca. FASE2 §18.1. */
export type CampoAlertado =
  | 'personal'
  | 'conductor'
  | 'placa'
  | 'observaciones'
  | 'puntoEncuentro'
  | 'tipoControl';

export interface Alerta {
  /** Identificador de FASE2 §18.1, para que el frontend no interprete cadenas. */
  codigo: string;
  campo: CampoAlertado;
  /** Redactado para el funcionario: se muestra tal cual. */
  mensaje: string;
  /** ALV-04 lleva borde crítico; las demás, Amarillo de Alerta. */
  critica: boolean;
}

/** Lo que hace falta saber del operativo para derivar sus alertas. */
export interface EstadoParaAlertas {
  /** Cuántas personas tiene asignadas. ALV-01. */
  personasAsignadas: number;
  politicaVehiculo: PoliticaVehiculo;
  estadoTransporte: EstadoTransporte;
  /** `form_condicionante_noct` del formulario. ALV-04. */
  condicionanteNocturno: boolean;
  /** Derivado del horario y de la franja configurada. ALV-04. */
  esNocturno: boolean;
  /** RN-20. Informado cuando el punto se capturó como adicional. ALV-06. */
  puntoLibre: string | null;
  /** RN-20. Ídem para el tipo de control. ALV-06. */
  tipoLibre: string | null;
  /**
   * Transporte requerido (2026-10-07). Lo que pide quien registra. Con PROPIOS_MEDIOS no se
   * solicita vehículo a la DAF, así que no hay conductor que esperar: no hay ALV-02/03/04.
   */
  tipoTransporte: TipoTransporte;
  /** ALV-07. El registro cambió el tipo con la asignación hecha y esta se liberó. */
  transporteLiberado: boolean;
}

/**
 * Todas las alertas del operativo, en el orden en que se presentan.
 *
 * @returns arreglo vacío si el operativo está completo.
 */
export function calcularAlertas(estado: EstadoParaAlertas): Alerta[] {
  return [
    ...alertaPersonal(estado),
    ...alertasDeTransporte(estado),
    ...alertasDeCapturaLibre(estado),
  ];
}

/** ALV-01. El operativo no tiene funcionarios. */
function alertaPersonal(estado: EstadoParaAlertas): Alerta[] {
  if (estado.personasAsignadas > 0) return [];

  return [
    {
      codigo: 'ALV-01',
      campo: 'personal',
      mensaje: 'Este operativo todavía no tiene personal asignado.',
      critica: false,
    },
  ];
}

/**
 * ALV-02, ALV-03 y ALV-04. Las tres dependen de que el transporte siga pendiente.
 *
 * `NO_APLICA` no produce ninguna: son los formularios que operan por propios medios o
 * que no habilitan vehículo (RN-41 y RN-42). Marcar en amarillo una celda que el
 * formulario ni siquiera muestra sería una alerta que nadie puede resolver.
 *
 * `PROPIOS_MEDIOS` tampoco: la DAF ya decidió, y decidir que no hace falta vehículo es
 * completar el dato, no dejarlo pendiente.
 */
function alertasDeTransporte(estado: EstadoParaAlertas): Alerta[] {
  if (estado.politicaVehiculo === PoliticaVehiculo.NO_APLICA) return [];
  if (estado.estadoTransporte !== EstadoTransporte.PENDIENTE) return [];
  // Quien registra pidió PROPIOS_MEDIOS: no se solicita vehículo a la DAF y no hay nada que
  // completar. Marcarlo en amarillo sería una alerta que nadie puede resolver.
  if (estado.tipoTransporte === TipoTransporte.PROPIOS_MEDIOS) return [];

  // ALV-04. El condicionante nocturno convierte lo pendiente en crítico: RN-43 exige
  // conductor cuando el horario entra en la franja, y sin él el cuadro no cierra
  // (INV-11, verificado en M-13).
  const critica = estado.condicionanteNocturno && estado.esNocturno;

  const conductor: Alerta = critica
    ? {
        codigo: 'ALV-04',
        campo: 'conductor',
        mensaje:
          'Este operativo tiene horario nocturno y requiere conductor asignado obligatoriamente. Sin él, la jornada no se puede cerrar.',
        critica: true,
      }
    : {
        codigo: 'ALV-02',
        campo: 'conductor',
        mensaje: 'La DAF todavía no ha asignado conductor a este operativo.',
        critica: false,
      };

  // ALV-07 (2026-10-07). El registro cambió el tipo de transporte con la asignación hecha y
  // esta se liberó: la DAF debe volver a asignarlo. Va antes que el resto para que se vea primero.
  const liberado: Alerta[] = estado.transporteLiberado
    ? [
        {
          codigo: 'ALV-07',
          campo: 'conductor',
          mensaje:
            'Transporte liberado: el registro cambió el tipo de transporte. La DAF debe volver a asignarlo.',
          critica: false,
        },
      ]
    : [];

  return [
    ...liberado,
    conductor,
    {
      codigo: 'ALV-03',
      campo: 'placa',
      mensaje: 'La placa del vehículo se completa junto con el conductor.',
      critica: false,
    },
  ];
}

/**
 * ALV-06. Punto o tipo capturados como adicionales.
 *
 * NO ES UN ERROR: RN-20 admite la captura libre en los formularios que la ofrecen. La
 * alerta marca la celda para **normalización posterior**, que es lo que permite que el
 * administrador incorpore al catálogo lo que se repite. Se emite una por campo, porque
 * son dos celdas distintas del cuadro.
 */
function alertasDeCapturaLibre(estado: EstadoParaAlertas): Alerta[] {
  const alertas: Alerta[] = [];

  if (estado.puntoLibre) {
    alertas.push({
      codigo: 'ALV-06',
      campo: 'puntoEncuentro',
      mensaje: `El punto «${estado.puntoLibre}» se capturó como adicional y no está en el catálogo.`,
      critica: false,
    });
  }

  if (estado.tipoLibre) {
    alertas.push({
      codigo: 'ALV-06',
      campo: 'tipoControl',
      mensaje: `El tipo de control «${estado.tipoLibre}» se capturó como adicional y no está en el catálogo.`,
      critica: false,
    });
  }

  return alertas;
}
