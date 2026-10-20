/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Utilidades transversales
 * Archivo: texto.ts
 * Responsabilidad: Normalizar denominaciones para compararlas y para guardarlas en su forma.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * POR QUÉ EXISTE. `uq_tipo_control_nombre` y `uq_institucion_sigla` distinguen
 * mayúsculas y acentos, de modo que «Control de ruido» y «CONTROL DE RUIDO» conviven
 * como dos filas distintas del mismo catálogo. La semilla de M-03 detecta e informa
 * esos casos en los datos de origen; esta utilidad los impide al crearse nuevos.
 *
 * `prisma/seed.ts` conserva una copia privada de `sinAcentos` porque se ejecuta fuera
 * del contenedor de Nest. Consolidar ambas queda registrado como refactor pendiente en
 * M07_FORMULARIOS_CATALOGOS.md §9.
 */

/** Retira las marcas diacríticas sin escribirlas literalmente en el patrón. */
export function sinAcentos(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

/**
 * Forma canónica de una denominación de catálogo: sin acentos, en mayúsculas y con
 * los espacios colapsados. Dos valores con la misma forma canónica son, para el
 * negocio, el mismo valor escrito de dos maneras.
 */
export function normalizarParaComparar(texto: string): string {
  return sinAcentos(texto).toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Nombre de un tipo de control tal como se guarda (2026-10-13): sin espacios sobrantes y en
 * MAYÚSCULAS, conservando las tildes («reinspección» → «REINSPECCIÓN»). El catálogo se lee en
 * mayúsculas en todos los formularios; antes convivían «Alertas ECU 911» y «CONTROL LIBADORES».
 */
export function enMayusculas(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().toLocaleUpperCase('es');
}

/** Artículos y preposiciones que van en minúscula dentro de un nombre propio. */
const CONECTORES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y', 'e']);

/** Siglas que se escriben siempre en mayúsculas aunque el nombre llegue en otra forma. */
const SIGLAS = new Set(['DMQ']);

/** Primera letra en mayúscula y el resto en minúscula («CALDERÓN» → «Calderón»). */
const capitalizar = (palabra: string): string =>
  palabra
    .toLocaleLowerCase('es')
    .replace(/\p{L}/u, (letra) => letra.toLocaleUpperCase('es'));

/**
 * Nombre de una zonal en formato título (2026-10-13), para no mezclar «HOSPITAL CARLOS ANDRADE
 * MARIN» con «Zonal La Delicia». Reglas:
 *   - Cada palabra con inicial mayúscula; las siglas conocidas (DMQ) quedan en mayúsculas.
 *   - Los conectores (de, del, la, los…) van en minúscula, SALVO al inicio y justo después de
 *     «Zonal»: ahí el artículo es parte del nombre propio («Zonal La Mariscal»).
 *   - Si el nombre NO llegó todo en mayúsculas, la palabra que el usuario escribió en mayúsculas
 *     se respeta como sigla («Zonal AMC Norte»). Si llegó todo en mayúsculas no hay forma de
 *     distinguir una sigla de una palabra, y se capitaliza todo.
 */
export function aFormatoTitulo(texto: string): string {
  const palabras = texto.replace(/\s+/g, ' ').trim().split(' ');
  const todoEnMayusculas = texto === texto.toLocaleUpperCase('es');

  return palabras
    .map((palabra, indice) => {
      const minuscula = palabra.toLocaleLowerCase('es');
      if (SIGLAS.has(sinAcentos(palabra).toUpperCase())) {
        return palabra.toLocaleUpperCase('es');
      }
      const tieneLetras = /\p{L}/u.test(palabra);
      if (
        !todoEnMayusculas &&
        tieneLetras &&
        palabra.length > 1 &&
        palabra === palabra.toLocaleUpperCase('es')
      ) {
        return palabra;
      }
      const anterior =
        indice > 0 ? palabras[indice - 1].toLocaleLowerCase('es') : null;
      if (CONECTORES.has(minuscula) && indice > 0 && anterior !== 'zonal') {
        return minuscula;
      }
      return capitalizar(palabra);
    })
    .join(' ');
}
