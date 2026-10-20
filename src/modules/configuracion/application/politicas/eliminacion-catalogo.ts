/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: eliminacion-catalogo.ts
 * Responsabilidad: Decidir si un valor de catálogo se puede borrar de verdad, y por qué no.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-12
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA VARA PARA LA LISTA Y PARA EL BORRADO (rediseño de P-08, 2026-10-12).
 *
 * La pantalla deshabilita «Eliminar» con su motivo ANTES de que alguien lo pulse, y el endpoint
 * de borrado rechaza con 409 lo que no se puede borrar. Las dos preguntas son la misma y se
 * responden aquí: si un día divergieran, la pantalla ofrecería un botón que el servidor rechaza
 * —o al revés, ocultaría uno que funciona—.
 *
 * El orden de los motivos es el de la importancia para quien administra:
 *   1. Ya se usó en un cuadro → el historial lo necesita (INV-22): solo se desactiva.
 *   2. (zonal) Tiene puntos   → la FK del punto es restrictiva: hay que quitarlos o desactivarla.
 *
 * TODO SE CUENTA DENTRO DEL FORMULARIO (2026-10-13). La zonal que se borra es la DEL formulario
 * (`t_zonal_formulario`), nunca la zona de la ciudad: las fichas de personal, la flota y los
 * traslados cuelgan de la zona, que no se toca, así que ya no bloquean. Por lo mismo el DMQ de un
 * formulario se borra como cualquier otra zonal suya si nunca se usó.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Los datos que la decisión necesita. Solo `usos` es común a los cuatro catálogos. */
export interface UsoDeCatalogo {
  /** Operativos DEL FORMULARIO que registran el valor (los cuadros anteriores lo necesitan). */
  usos: number;
  /** Solo zonal: puntos de encuentro del formulario que cuelgan de ella, activos o no. */
  puntos?: number;
}

export interface VeredictoEliminacion {
  puedeEliminar: boolean;
  /** Por qué no, en palabras para el administrador; `null` si se puede. */
  motivoNoEliminar: string | null;
}

export const MOTIVO_USADO = 'Ya se usó en cuadros: solo puede desactivarse.';
export const MOTIVO_CON_PUNTOS =
  'Tiene puntos: elimínelos o desactive la zonal.';

/** Si el valor se puede borrar de verdad. Pura: la lista y el borrado la llaman igual. */
export function puedeEliminar(uso: UsoDeCatalogo): VeredictoEliminacion {
  const no = (motivo: string): VeredictoEliminacion => ({
    puedeEliminar: false,
    motivoNoEliminar: motivo,
  });

  if (uso.usos > 0) return no(MOTIVO_USADO);
  if ((uso.puntos ?? 0) > 0) return no(MOTIVO_CON_PUNTOS);
  return { puedeEliminar: true, motivoNoEliminar: null };
}
