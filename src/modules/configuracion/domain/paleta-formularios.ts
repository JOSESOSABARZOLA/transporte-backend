/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: paleta-formularios.ts
 * Responsabilidad: La paleta institucional con la que se pinta un formulario.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-29
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOS COLORES DE UN FORMULARIO SE ELIGEN DE UNA PALETA, NO SE TECLEAN.
 *
 * El manual de marca (skill diseno-sigoc) prohíbe hexadecimales escritos a mano, y hasta hoy
 * los colores de los nueve formularios venían de la semilla. Al abrir la creación de
 * formularios por pantalla, el administrador ELIGE un color de esta lista —cada entrada trae
 * su fondo, su acento y su nombre en palabras (regla 6)— en vez de escribir un hexadecimal.
 *
 * El servidor valida contra esta constante (`esColorDePaleta`), de modo que la paleta se
 * cumple aunque alguien llame al endpoint sin pasar por la pantalla. Son los mismos pasteles
 * que ya usan los nueve formularios más algunos tonos claros para tener de dónde elegir; el
 * acento es negro en todos (`#000000`), como los nueve: el texto va oscuro sobre el pastel.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Un color de la paleta: cómo se pinta el banner (fondo/acento) y cómo se llama (regla 6). */
export interface ColorFormulario {
  nombre: string;
  fondo: string;
  acento: string;
}

/** El acento es negro en todos: el texto oscuro se lee sobre el pastel del fondo. */
const ACENTO = '#000000';

/**
 * La paleta institucional. Los nueve primeros son los tonos que ya usan los formularios
 * sembrados; el resto son pasteles claros para tener variedad al crear nuevos.
 */
export const PALETA_FORMULARIOS: readonly ColorFormulario[] = [
  { nombre: 'Verde azulado', fondo: '#A2C4C9', acento: ACENTO },
  { nombre: 'Naranja claro', fondo: '#FCE5CD', acento: ACENTO },
  { nombre: 'Azul', fondo: '#B4C6E7', acento: ACENTO },
  { nombre: 'Gris', fondo: '#D9D9D9', acento: ACENTO },
  { nombre: 'Rosado', fondo: '#FFCCCC', acento: ACENTO },
  { nombre: 'Rojo claro', fondo: '#F4CCCC', acento: ACENTO },
  { nombre: 'Naranja fuerte', fondo: '#FCE4D6', acento: ACENTO },
  { nombre: 'Morado', fondo: '#CCCCFF', acento: ACENTO },
  { nombre: 'Verde pastel', fondo: '#D9EAD3', acento: ACENTO },
  { nombre: 'Amarillo claro', fondo: '#FFF2CC', acento: ACENTO },
  { nombre: 'Celeste', fondo: '#DEEBF7', acento: ACENTO },
  { nombre: 'Lavanda', fondo: '#E4DFEC', acento: ACENTO },
  { nombre: 'Verde menta', fondo: '#C6E0B4', acento: ACENTO },
  { nombre: 'Durazno', fondo: '#F8CBAD', acento: ACENTO },
];

/**
 * ¿El trío (fondo, acento, nombre) corresponde EXACTAMENTE a una entrada de la paleta?
 * La comparación de hex ignora mayúsculas (la base los guarda en mayúsculas); el nombre debe
 * coincidir tal cual, para que no se guarde un color con un nombre que no le corresponde.
 */
export function esColorDePaleta(
  fondo: string,
  acento: string,
  nombre: string,
): boolean {
  return PALETA_FORMULARIOS.some(
    (color) =>
      color.fondo.toUpperCase() === fondo.toUpperCase() &&
      color.acento.toUpperCase() === acento.toUpperCase() &&
      color.nombre === nombre,
  );
}
