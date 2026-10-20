/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: formulario-admin.ts
 * Responsabilidad: Decidir las reglas del alta y la edición de un formulario sin tocar la base.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * REDISEÑO DE «FORMULARIOS DEL CUADRO» (P-09, 2026-10-13).
 *
 * 1. NÚMERO, CÓDIGO Y ÁREAS NO SE EDITAN AQUÍ. Número y código los referencian los operativos y
 *    la identidad legible del formulario; las áreas tienen UNA sola puerta, Catálogos del cuadro
 *    (`PUT /administracion/formularios/:codigo/areas`). Si llegan, el DTO responde 400 con los
 *    mensajes de `MENSAJES_CAMPO_FIJO`, en vez de descartarlos.
 *
 * 2. EL PREFIJO «GENERAL» ES EL ÚNICO QUE SE EDITA. Un formulario puede tener varios prefijos
 *    (`t_formulario_prefijo`): por área, para adicionales y uno general (sin área, ordinario).
 *    Solo el general se cambia desde la pantalla; los demás son de la numeración por área y se
 *    muestran en solo lectura. Un formulario que numera SOLO por área (el 8) no tiene general.
 *
 * 3. UN PREFIJO NO SE REPITE ENTRE FORMULARIOS. Dos formularios con el mismo prefijo darían el
 *    mismo identificador (`OCF-001-09-OCT-2026`) a operativos distintos. Se compara contra TODOS
 *    los prefijos de los demás formularios, activos o no, sin distinguir mayúsculas.
 *
 * 4. EL NOMBRE SE GUARDA EN MAYÚSCULAS: así aparece en el cuadro y en las órdenes.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** El rango que admite `ck_formulario_numero` (migración 20260929120000). */
export const NUMERO_MAXIMO_FORMULARIO = 99;

/** Lo que se responde si la edición trae un campo que se fija al crear o que se edita en otra parte. */
export const MENSAJES_CAMPO_FIJO = {
  numero:
    'El número del formulario no se puede cambiar: queda fijo al crearlo.',
  codigo:
    'El código del formulario no se puede cambiar: queda fijo al crearlo.',
  areas:
    'Las áreas de personal se configuran en Catálogos del cuadro, no en el formulario.',
} as const;

/** Una fila de `t_formulario_prefijo`, con lo que la decisión necesita. */
export interface PrefijoDeFormulario {
  id: number;
  prefijo: string;
  areaAplica: string | null;
  esPredeterminado: boolean;
  esAdicional: boolean;
}

/** Un prefijo de cualquier formulario, para comprobar que no se repita. */
export interface PrefijoEnUso {
  formularioId: number;
  prefijo: string;
}

/** Qué hacer con el prefijo que pide la edición. */
export type CambioDePrefijo =
  | { accion: 'ninguna' }
  | { accion: 'actualizar'; id: number; prefijo: string }
  | { accion: 'rechazar'; mensaje: string };

/** El nombre tal como se guarda: sin espacios sobrantes y en MAYÚSCULAS. */
export function nombreDeFormulario(nombre: string): string {
  return nombre.trim().replace(/\s+/g, ' ').toLocaleUpperCase('es');
}

/** El prefijo tal como se guarda y se compara: sin espacios y en MAYÚSCULAS. */
export function normalizarPrefijo(prefijo: string): string {
  return prefijo.trim().toLocaleUpperCase('es');
}

/**
 * El número libre más bajo del 1 al 99 (activos e inactivos ocupan el suyo), o `null` si están
 * todos. Es el que la pantalla sugiere al crear: «Se agregará como formulario N.º 11».
 */
export function numeroLibreMasBajo(usados: readonly number[]): number | null {
  const ocupados = new Set(usados);
  for (let numero = 1; numero <= NUMERO_MAXIMO_FORMULARIO; numero += 1) {
    if (!ocupados.has(numero)) return numero;
  }
  return null;
}

/**
 * El prefijo general del formulario: el predeterminado sin área ni adicional; si no lo marcó
 * nadie y hay UNA sola fila sin área ni adicional, esa. `null` si numera solo por área o si hay
 * varias candidatas sin predeterminado (no hay forma honesta de elegir).
 */
export function prefijoGeneral(
  prefijos: readonly PrefijoDeFormulario[],
): PrefijoDeFormulario | null {
  const ordinarios = prefijos.filter(
    (fila) => fila.areaAplica === null && !fila.esAdicional,
  );
  const predeterminado = ordinarios.find((fila) => fila.esPredeterminado);
  if (predeterminado) return predeterminado;
  return ordinarios.length === 1 ? ordinarios[0] : null;
}

/** El prefijo que la pantalla muestra: el general o, si no lo hay, el primero. */
export function prefijoMostrado(
  prefijos: readonly PrefijoDeFormulario[],
): string | null {
  return prefijoGeneral(prefijos)?.prefijo ?? prefijos[0]?.prefijo ?? null;
}

/** ¿Lo usa ya OTRO formulario? `formularioId` es `null` en un alta. */
export function prefijoUsadoPorOtro(
  prefijo: string,
  formularioId: number | null,
  enUso: readonly PrefijoEnUso[],
): boolean {
  const buscado = normalizarPrefijo(prefijo);
  return enUso.some(
    (fila) =>
      fila.formularioId !== formularioId &&
      normalizarPrefijo(fila.prefijo) === buscado,
  );
}

/** El 409 de un prefijo repetido. */
export function mensajePrefijoRepetido(prefijo: string): string {
  return `El prefijo ${normalizarPrefijo(prefijo)} ya lo usa otro formulario: los identificadores se confundirían.`;
}

/**
 * Decide qué hacer con el prefijo de una edición. Solo cambia el general, y solo si es distinto
 * del actual (guardar sin tocarlo no escribe nada). Un formulario sin prefijo general rechaza
 * cualquier prefijo distinto del que se le muestra.
 */
export function decidirCambioDePrefijo(
  prefijos: readonly PrefijoDeFormulario[],
  pedido: string | undefined,
): CambioDePrefijo {
  if (pedido === undefined) return { accion: 'ninguna' };

  const limpio = normalizarPrefijo(pedido);
  const general = prefijoGeneral(prefijos);

  if (general) {
    return normalizarPrefijo(general.prefijo) === limpio
      ? { accion: 'ninguna' }
      : { accion: 'actualizar', id: general.id, prefijo: limpio };
  }

  const mostrado = prefijoMostrado(prefijos);
  if (mostrado !== null && normalizarPrefijo(mostrado) === limpio) {
    return { accion: 'ninguna' };
  }

  const lista = prefijos.map((fila) => fila.prefijo).join(', ');
  return {
    accion: 'rechazar',
    mensaje: `Este formulario numera por área (${lista}): su prefijo no se cambia desde aquí.`,
  };
}
