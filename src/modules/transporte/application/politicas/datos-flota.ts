/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Flota y garajes
 * Archivo: datos-flota.ts
 * Responsabilidad: Decidir qué le falta a un conductor, si una placa tiene formato válido y los
 *   indicadores de la pantalla de flota.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-14
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UN CONDUCTOR «INCOMPLETO» ES EL QUE LA DAF NO PUEDE PLANIFICAR BIEN:
 *   · sin vehículo habitual (o con uno dado de baja): ningún vehículo se le propone;
 *   · sin tipo de contrato: la regla de nocturnidad por nombramiento no se le aplica;
 *   · sin patrón de rotación: los turnos del mes no se le proponen.
 * Sector, teléfono y licencia no lo vuelven incompleto: informan, no bloquean.
 *
 * LA PLACA (decisión D4 del 2026-10-14): tres letras, guion y tres o cuatro dígitos (AAA-999 /
 * AAA-9999). Se exige solo al crear o al cambiar la placa: las ya registradas no se rompen.
 * `normalizarPlaca` es la ÚNICA forma de escribirla (2026-10-15, A1): la usan el alta, la edición,
 * la carga inicial y la búsqueda de duplicados; «PMA3370», «pma-3370» y «PMA 3370» son la misma.
 * La migración `20261015090000_placas_normalizadas` dejó las registradas en esa forma.
 *
 * EL KILOMETRAJE (A2): entero de 0 a DAF_KM_MAXIMO; el tope llega como dato.
 *
 * ES PURA: recibe los datos y el día; no lee la base ni parámetros.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { estadoDocumentos } from './vencimiento-documentos';

export type FaltanteConductor =
  | 'VEHICULO_HABITUAL'
  | 'TIPO_CONTRATO'
  | 'PATRON_ROTACION';

/** AAA-999 o AAA-9999, ya en mayúsculas. */
const PATRON_PLACA = /^[A-Z]{3}-\d{3,4}$/;

/** La misma placa escrita sin guion («PBA1235»): se le pone, no se rechaza. */
const PLACA_SIN_GUION = /^([A-Z]{3})(\d{3,4})$/;

export function esPlacaValida(placa: string): boolean {
  return PATRON_PLACA.test(placa);
}

/**
 * Mayúsculas, sin espacios ni guiones y con el guion en su sitio («pma 3370» → «PMA-3370»). Lo que
 * no tiene forma de placa se devuelve en mayúsculas y sin espacios ni guiones: no valida, eso lo
 * hace `esPlacaValida`.
 */
export function normalizarPlaca(placa: string): string {
  const limpia = placa.toUpperCase().replace(/[\s-]+/g, '');
  return limpia.replace(PLACA_SIN_GUION, '$1-$2');
}

/** Dos placas son la misma si coinciden normalizadas: «PMA3370» y «PMA-3370» son duplicado. */
export function esMismaPlaca(a: string, b: string): boolean {
  return normalizarPlaca(a) === normalizarPlaca(b);
}

/** Un kilometraje por encima del tope es casi siempre un cero de más al teclearlo. */
export function kilometrajeExcedeTope(
  kilometraje: number | null | undefined,
  kmMaximo: number,
): boolean {
  return (
    kilometraje !== null && kilometraje !== undefined && kilometraje > kmMaximo
  );
}

export function faltantesDeConductor(conductor: {
  vehiculoHabitual: { activo: boolean } | null;
  tipoContrato: string | null;
  patronRotacion: string | null;
}): FaltanteConductor[] {
  const faltantes: FaltanteConductor[] = [];
  if (!conductor.vehiculoHabitual?.activo) faltantes.push('VEHICULO_HABITUAL');
  if (!conductor.tipoContrato) faltantes.push('TIPO_CONTRATO');
  if (!conductor.patronRotacion) faltantes.push('PATRON_ROTACION');
  return faltantes;
}

/** Garaje vigente = activo Y autorizado (decisión D2): es el único que se ofrece a la DAF. */
export function esGarajeVigente(garaje: {
  activo: boolean;
  garajeAutorizado: boolean;
}): boolean {
  return garaje.activo && garaje.garajeAutorizado;
}

export interface ResumenFlota {
  vehiculos: {
    activos: number;
    deBaja: number;
    /** Vencidos + por vencer (la más crítica de matrícula y SOAT). */
    documentosPorVencer: number;
    /** Sin matrícula ni SOAT, o sin una de las dos (SIN_FECHAS + INCOMPLETO): un dato faltante (A5, F1). */
    sinFechas: number;
    sinConductorHabitual: number;
    /** Activos con una cita de taller que los cubre hoy y no está LISTO (2026-10-20). */
    enTallerHoy: number;
  };
  conductores: { activos: number; deBaja: number; incompletos: number };
  garajes: { vigentes: number; deBaja: number };
}

/**
 * Los indicadores de la pantalla y los contadores de sus pestañas. Solo cuentan los vehículos y
 * conductores ACTIVOS: uno dado de baja ya no se asigna y no tiene nada que avisar.
 * «Sin conductor habitual» = ningún conductor ACTIVO lo tiene como habitual. «En taller hoy»
 * (2026-10-20) = activos cuyo id viene en `enTaller` (las citas que cubren hoy y no están LISTO).
 */
export function resumenDeFlota(
  vehiculos: readonly {
    id: number;
    activo: boolean;
    matriculaVencimiento: Date | null;
    soatVencimiento: Date | null;
  }[],
  conductores: readonly {
    activo: boolean;
    vehiculoHabitualId: number | null;
    vehiculoHabitual: { activo: boolean } | null;
    tipoContrato: string | null;
    patronRotacion: string | null;
  }[],
  garajes: readonly { activo: boolean; garajeAutorizado: boolean }[],
  hoy: string,
  diasAviso: number,
  enTaller: readonly (number | null)[] = [],
): ResumenFlota {
  const activos = vehiculos.filter((v) => v.activo);
  const conductoresActivos = conductores.filter((c) => c.activo);
  const conHabitual = new Set(
    conductoresActivos
      .map((c) => c.vehiculoHabitualId)
      .filter((id): id is number => id !== null),
  );
  const vigentes = garajes.filter(esGarajeVigente).length;
  const taller = new Set(enTaller);
  const estados = activos.map(
    (v) =>
      estadoDocumentos(
        v.matriculaVencimiento,
        v.soatVencimiento,
        hoy,
        diasAviso,
      ).estado,
  );

  return {
    vehiculos: {
      activos: activos.length,
      deBaja: vehiculos.length - activos.length,
      documentosPorVencer: estados.filter(
        (e) => e === 'VENCIDO' || e === 'POR_VENCER',
      ).length,
      sinFechas: estados.filter((e) => e === 'SIN_FECHAS' || e === 'INCOMPLETO')
        .length,
      sinConductorHabitual: activos.filter((v) => !conHabitual.has(v.id))
        .length,
      enTallerHoy: activos.filter((v) => taller.has(v.id)).length,
    },
    conductores: {
      activos: conductoresActivos.length,
      deBaja: conductores.length - conductoresActivos.length,
      incompletos: conductoresActivos.filter(
        (c) => faltantesDeConductor(c).length > 0,
      ).length,
    },
    garajes: { vigentes, deBaja: garajes.length - vigentes },
  };
}
