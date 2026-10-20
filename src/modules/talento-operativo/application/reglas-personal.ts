/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Maestro de personal
 * Archivo: reglas-personal.ts
 * Responsabilidad: Validar la identidad del funcionario y sus períodos de ausencia.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Funciones puras: no tocan la base ni el contenedor. Se prueban solas.
 */

/**
 * Los períodos y las fechas viven desde el 2026-10-16 en `common/ausencias/reglas-ausencia.ts`
 * (los comparte la flota para las ausencias de conductores). Se reexportan aquí para que las
 * importaciones existentes no cambien.
 */
export {
  aFechaUtc,
  comoFechaIso,
  cubre,
  ESTADOS_DE_PERSONA,
  ESTADOS_QUE_EXCLUYEN,
  estadoDeAusencia,
  excluyeDelOperativo,
  seSolapan,
  type EstadoDeAusencia,
  type Periodo,
} from '../../../common/ausencias/reglas-ausencia';

// ─────────────────────────── Cédula ───────────────────────────

/**
 * Comprueba la cédula ecuatoriana: diez dígitos, provincia válida y dígito
 * verificador de módulo 10.
 *
 * POR QUÉ SE VALIDA Y NO SOLO SE EXIGE QUE SEA NUMÉRICA. La cédula es la clave natural
 * del maestro —`uq_funcionario_cedula`— y aparece en las órdenes de servicio. Un
 * dígito mal escrito crea una persona duplicada que nadie detecta hasta que dos
 * registros distintos reclaman ser la misma, y para entonces ya hay operativos
 * colgando de ambos.
 *
 * LÍMITE CONOCIDO: rechaza pasaportes. Ningún funcionario del insumo lo requiere, y
 * admitirlos exige decidir cómo se comprueban. Ver M10_PERSONAL_DISPONIBILIDAD.md §8.
 */
export function esCedulaValida(cedula: string): boolean {
  if (!/^\d{10}$/.test(cedula)) return false;

  const provincia = Number(cedula.slice(0, 2));
  if (provincia < 1 || provincia > 24) return false;

  const digitos = cedula.split('').map(Number);
  const verificador = digitos[9];

  // Módulo 10: las posiciones impares se duplican y, si pasan de nueve, se les resta.
  const suma = digitos.slice(0, 9).reduce((total, digito, indice) => {
    if (indice % 2 !== 0) return total + digito;
    const doble = digito * 2;
    return total + (doble > 9 ? doble - 9 : doble);
  }, 0);

  const decenaSuperior = Math.ceil(suma / 10) * 10;
  const esperado = decenaSuperior - suma === 10 ? 0 : decenaSuperior - suma;

  return esperado === verificador;
}

/**
 * LONGITUD DE LA CÉDULA, EN UN SOLO SITIO (Opción B, 2026-09-28). Cambiar este número —y su gemelo
 * del frontend, `LONGITUD_CEDULA` en `validationSchemas.ts`— ajusta la validación en TODO el
 * backend: este archivo y los DTO (`personal.dto.ts`, `administrar-usuarios.dto.ts`) derivan de
 * aquí, no repiten el `10`. Hasta 13 no requiere migración (`func_cedula`/`cond_cedula` son
 * `VarChar(13)`); pasar de 13 sí. Un cambio de longitud de cédula es un evento nacional que se
 * planifica, así que un redeploy con este único cambio es suficiente.
 */
export const LONGITUD_CEDULA = 10;

/** Formato de cédula derivado de `LONGITUD_CEDULA`: esa cantidad de dígitos, sin nada más. */
export const PATRON_CEDULA = new RegExp(`^\\d{${LONGITUD_CEDULA}}$`);

/**
 * FORMATO BÁSICO DE CÉDULA: `LONGITUD_CEDULA` dígitos numéricos. NO comprueba el dígito verificador
 * (módulo 10).
 *
 * DESACTIVACIÓN DEL VERIFICADOR (2026-09-28, por decisión del negocio): los servicios exigen solo
 * este formato, para poder registrar cédulas que el algoritmo del Registro Civil no cubre.
 * `esCedulaValida` —el módulo 10 completo— se conserva intacta por si se reactiva, pero
 * `funcionarios.service` y `flota.service` ya no la llaman.
 */
export function tieneFormatoCedula(cedula: string): boolean {
  return PATRON_CEDULA.test(cedula);
}

/**
 * RN-34. El teléfono vive únicamente en el maestro de personal.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * CELULAR ECUATORIANO: 10 DÍGITOS QUE EMPIEZAN POR 09. Desde el 2026-10-08 (rediseño de
 * P-07). Antes era holgada —de 7 a 13 dígitos—, y en el maestro acabaron fijos de oficina y
 * números con prefijo internacional a los que no se puede escribir por mensajería, que es
 * para lo que se pide el dato. Se toleran los espacios y guiones de quien lo dicta por
 * partes («098 514 4231»): se miran solo los dígitos.
 *
 * Solo se exige AL ESCRIBIR. Las fichas que ya tienen un número con el formato anterior no se
 * tocan hasta que alguien las edite y envíe el teléfono.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function esTelefonoValido(telefono: string): boolean {
  const soloDigitos = telefono.replace(/[\s-]/g, '');
  return /^09\d{8}$/.test(soloDigitos);
}

/**
 * El correo de la ficha. Añadido el 2026-09-01.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOLGADA POR EL MISMO MOTIVO QUE EL TELÉFONO, y no por descuido. Comprueba que haya algo
 * antes de la arroba, algo después, y un punto en el dominio. Nada más.
 *
 * NO SE VALIDA CONTRA EL DOMINIO INSTITUCIONAL. Sería tentador exigir `@quito.gob.ec` y
 * sería un error: la AMC trabaja con personal de otras instituciones —los operativos
 * conjuntos son la mitad del cuadro— y el día que entre alguien de la Policía o de la
 * Secretaría de Seguridad, el campo lo rechazaría sin que nadie recordara por qué.
 *
 * NI CON UNA EXPRESIÓN «COMPLETA» DE RFC 5322. Las que circulan tienen cientos de
 * caracteres, rechazan direcciones válidas y aceptan basura igual. Quien decide de verdad
 * si un correo existe es el servidor de correo, y aquí no se le pregunta: esto solo evita
 * el dedazo evidente —un teléfono pegado en el campo equivocado— antes de guardarlo.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function esCorreoValido(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}
