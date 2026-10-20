/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · línea de tiempo por conductor
 * Archivo: parametros-transporte.service.ts
 * Responsabilidad: Leer de una vez los parámetros de la planificación por tramos (regla 2).
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * Todos los umbrales de la asignación por tramos viven en `t_parametro_politica`; aquí se leen en
 * paralelo y se entregan ya convertidos (ventanas en franjas de la línea de tiempo) para que las
 * políticas puras no lean nada. Ningún valor está escrito a mano: si falta un parámetro, la lectura
 * falla con el mensaje del servicio de parámetros, igual que el resto del sistema.
 */

import { Injectable } from '@nestjs/common';

import { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import type { ParametrosAsignacion } from './politicas/asignacion-conductor.policy';
import { franjaDe, type Franja } from './politicas/linea-de-tiempo';
import type { DuracionesTramo } from './politicas/plan-tramos';
import {
  interpretarMinimos,
  type ReglasRotacion,
} from './politicas/propuesta-turnos.policy';

export interface ParametrosPlanificacion {
  inicioJornada: string;
  /** DAF_DURACION_DEJAR_MIN y DAF_DURACION_RETIRAR_MIN (D7); si faltan, DAF_DURACION_TRAMO_MIN. */
  duracionTramo: DuracionesTramo;
  /** DAF_HUECO_MINIMO_MIN (2026-10-14): desde cuántos minutos útiles un hueco es aprovechable. */
  huecoMinimoMin: number;
  ventanaNombramiento: Franja;
  ventanasTurno: { DIA: Franja; NOCHE: Franja; ECU_NOCHE: Franja };
  asignacion: Omit<ParametrosAsignacion, 'tablaTraslados'>;
}

/** Parámetros de las Fases 3 y 5 (optimizador, fin del día y taller), regla 2. */
export interface ParametrosOptimizacion {
  /** COMPARTIR_VENTANA_MIN: ± minutos de inicio para compartir carro. */
  compartirVentanaMin: number;
  /** GUARDA_HORA_TARDE: desde qué hora («HH:MM») un cierre es tarde. */
  guardaHoraTarde: string;
  /** DURACION_TAREA_TALLER_MIN: duración de la TAREA «Llevar a taller». */
  duracionTareaTallerMin: number;
}

@Injectable()
export class ParametrosTransporteService {
  constructor(private readonly parametros: ParametroPoliticaService) {}

  /**
   * Reglas de la matriz de turnos de conductores (2026-10-07). «Sin configurar» —SIN_CONFIGURAR
   * o 0— llega como `null`: la regla no se evalúa.
   */
  async leerRotacion(): Promise<ReglasRotacion> {
    const [minDia, minNoche, maxSinLibre, nocheADia] = await Promise.all([
      this.parametros.obtenerTexto('DAF_MIN_CONDUCTORES_DIA'),
      this.parametros.obtenerTexto('DAF_MIN_CONDUCTORES_NOCHE'),
      this.parametros.obtenerEntero('DAF_MAX_DIAS_SIN_LIBRE'),
      this.parametros.obtenerTexto('DAF_PERMITE_NOCHE_A_DIA'),
    ]);
    const permite = nocheADia.trim().toUpperCase();
    return {
      minimosDia: interpretarMinimos(minDia),
      minimosNoche: interpretarMinimos(minNoche),
      maxDiasSinLibre: maxSinLibre > 0 ? maxSinLibre : null,
      permiteNocheADia:
        permite === 'SI' ? true : permite === 'NO' ? false : null,
    };
  }

  /** DAF_DIAS_AVISO_VENCIMIENTO: anticipación del aviso de SOAT y matrícula. */
  async leerDiasAvisoVencimiento(): Promise<number> {
    return this.parametros.obtenerEntero('DAF_DIAS_AVISO_VENCIMIENTO');
  }

  /** DAF_KM_MAXIMO (2026-10-15): tope del kilometraje de un vehículo. */
  async leerKmMaximo(): Promise<number> {
    return this.parametros.obtenerEntero('DAF_KM_MAXIMO');
  }

  async leerOptimizacion(): Promise<ParametrosOptimizacion> {
    const [compartirVentanaMin, guardaHoraTarde, duracionTareaTallerMin] =
      await Promise.all([
        this.parametros.obtenerEntero('COMPARTIR_VENTANA_MIN'),
        this.parametros.obtenerTexto('GUARDA_HORA_TARDE'),
        this.parametros.obtenerEntero('DURACION_TAREA_TALLER_MIN'),
      ]);
    return { compartirVentanaMin, guardaHoraTarde, duracionTareaTallerMin };
  }

  /**
   * Lo justo para decidir si dos operativos comparten unidad (2026-10-19): las duraciones de los
   * tramos (para planificarlos) y COMPARTIR_VENTANA_MIN. Lo usa el registro, que no necesita el
   * resto de la planificación.
   */
  async leerCompartir(): Promise<{
    duracionTramo: DuracionesTramo;
    ventanaMin: number;
    /** Desde dónde se miden las franjas: dos traslados se cruzan o no en el mismo reloj del día. */
    inicioJornada: string;
  }> {
    const [general, dejar, retirar, ventanaMin, inicioJornada] =
      await Promise.all([
        this.parametros.obtenerEntero('DAF_DURACION_TRAMO_MIN'),
        this.parametros.obtenerTextoOpcional('DAF_DURACION_DEJAR_MIN'),
        this.parametros.obtenerTextoOpcional('DAF_DURACION_RETIRAR_MIN'),
        this.parametros.obtenerEntero('COMPARTIR_VENTANA_MIN'),
        this.parametros.obtenerTexto('INICIO_JORNADA_TRANSPORTE'),
      ]);
    return {
      duracionTramo: duracionesDe(general, dejar, retirar),
      ventanaMin,
      inicioJornada,
    };
  }

  async leer(): Promise<ParametrosPlanificacion> {
    const p = this.parametros;
    const [
      inicioJornada,
      nombramientoInicio,
      nombramientoFin,
      duracionTramo,
      maxJornada,
      avisoJornada,
      descansoMin,
      mismaZona,
      mismoSector,
      otroSector,
      costoAviso,
      costoActivarLibre,
      costoArranqueLejos,
      diaInicio,
      diaFin,
      nocheInicio,
      nocheFin,
      ecuInicio,
      ecuFin,
      duracionDejar,
      duracionRetirar,
      huecoMinimoMin,
    ] = await Promise.all([
      p.obtenerTexto('INICIO_JORNADA_TRANSPORTE'),
      p.obtenerTexto('HORA_NOMBRAMIENTO_INICIO'),
      p.obtenerTexto('HORA_NOMBRAMIENTO_CONDUCTOR_FIN'),
      p.obtenerEntero('DAF_DURACION_TRAMO_MIN'),
      p.obtenerEntero('DAF_MAX_JORNADA_HORAS'),
      p.obtenerEntero('DAF_JORNADA_AVISO_HORAS'),
      p.obtenerEntero('DAF_DESCANSO_MIN_HORAS'),
      p.obtenerEntero('TRASLADO_MISMA_ZONA_MIN'),
      p.obtenerEntero('TRASLADO_MISMO_SECTOR_MIN'),
      p.obtenerEntero('TRASLADO_OTRO_SECTOR_MIN'),
      p.obtenerEntero('COSTO_PENALIZACION_AVISO'),
      p.obtenerEntero('COSTO_ACTIVAR_LIBRE'),
      p.obtenerEntero('COSTO_ARRANQUE_LEJOS'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_DIA_INICIO'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_DIA_FIN'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_NOCHE_INICIO'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_NOCHE_FIN'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_ECU_NOCHE_INICIO'),
      p.obtenerTexto('HORA_TURNO_CONDUCTOR_ECU_NOCHE_FIN'),
      p.obtenerTextoOpcional('DAF_DURACION_DEJAR_MIN'),
      p.obtenerTextoOpcional('DAF_DURACION_RETIRAR_MIN'),
      p.obtenerEntero('DAF_HUECO_MINIMO_MIN'),
    ]);
    return {
      inicioJornada,
      duracionTramo: duracionesDe(
        duracionTramo,
        duracionDejar,
        duracionRetirar,
      ),
      huecoMinimoMin,
      ventanaNombramiento: franjaDe(
        nombramientoInicio,
        nombramientoFin,
        inicioJornada,
      ),
      ventanasTurno: {
        DIA: franjaDe(diaInicio, diaFin, inicioJornada),
        NOCHE: franjaDe(nocheInicio, nocheFin, inicioJornada),
        ECU_NOCHE: franjaDe(ecuInicio, ecuFin, inicioJornada),
      },
      asignacion: {
        maxJornadaHoras: maxJornada,
        jornadaAvisoHoras: avisoJornada,
        descansoMinHoras: descansoMin,
        traslado: { mismaZona, mismoSector, otroSector },
        costoAviso,
        costoActivarLibre,
        costoArranqueLejos,
      },
    };
  }
}

/** D7 (2026-10-14): una duración por tipo de tramo. Sin configurar (o no entera), la general. */
function duracionesDe(
  general: number,
  dejar: string,
  retirar: string,
): DuracionesTramo {
  const minutosO = (texto: string): number => {
    const valor = Number(texto);
    return texto.trim() !== '' && Number.isInteger(valor) && valor > 0
      ? valor
      : general;
  };
  return { dejar: minutosO(dejar), retirar: minutosO(retirar) };
}
