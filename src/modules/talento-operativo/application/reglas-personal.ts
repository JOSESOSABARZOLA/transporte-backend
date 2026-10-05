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

import { EstadoDisponibilidad } from '@prisma/client';

/** Fecha sin hora, tal como la guarda `@db.Date`. */
export interface Periodo {
  desde: Date;
  hasta: Date;
}

/**
 * RN-30. Estados que EXCLUYEN a la persona de un operativo.
 *
 * `DISPONIBLE` no excluye —es el registro explícito de que sí está— y `MANTENIMIENTO`
 * no le corresponde: es de vehículos. Enumerar los que excluyen, en lugar de los que
 * no, evita que un estado nuevo entre por omisión como excluyente sin que nadie lo
 * decida.
 */
export const ESTADOS_QUE_EXCLUYEN: EstadoDisponibilidad[] = [
  EstadoDisponibilidad.VACACIONES,
  EstadoDisponibilidad.REPOSO_MEDICO,
  EstadoDisponibilidad.CALAMIDAD,
  EstadoDisponibilidad.PERMISO,
];

/** Estados que puede tener una persona. `MANTENIMIENTO` es solo de vehículos. */
export const ESTADOS_DE_PERSONA: EstadoDisponibilidad[] = [
  EstadoDisponibilidad.DISPONIBLE,
  ...ESTADOS_QUE_EXCLUYEN,
];

export function excluyeDelOperativo(estado: EstadoDisponibilidad): boolean {
  return ESTADOS_QUE_EXCLUYEN.includes(estado);
}

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
 * La comprobación es deliberadamente holgada: dígitos, espacios, guiones y un
 * prefijo internacional opcional. Rechazar formatos que el negocio usa —«98 514
 * 4231»— obligaría al administrador a pelear con el campo, y el teléfono no es una
 * clave: es un dato de contacto.
 */
export function esTelefonoValido(telefono: string): boolean {
  const soloDigitos = telefono.replace(/[\s\-()+]/g, '');
  return /^\d{7,13}$/.test(soloDigitos);
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

// ─────────────────────────── Períodos ───────────────────────────

/**
 * INV-14. Dos períodos de la misma persona no pueden solaparse.
 *
 * Los extremos son INCLUSIVOS: una ausencia del 1 al 15 comprende ambos días, y una
 * de un solo día tiene `desde` igual a `hasta`. Por eso la comparación usa `<=` y no
 * `<`, al revés que `RangoHorario`, donde encadenar dos operativos a la misma hora sí
 * es legítimo. Aquí encadenar sería estar dos veces ausente el mismo día.
 */
export function seSolapan(uno: Periodo, otro: Periodo): boolean {
  return uno.desde <= otro.hasta && otro.desde <= uno.hasta;
}

/** Un período cubre la fecha indicada. */
export function cubre(periodo: Periodo, fecha: Date): boolean {
  return periodo.desde <= fecha && fecha <= periodo.hasta;
}

/**
 * Interpreta una fecha `AAAA-MM-DD` en UTC.
 *
 * Las columnas son `@db.Date`, sin hora ni zona. Interpretarlas con el huso del
 * proceso desplazaría la ausencia un día en cualquier servidor al oeste de Greenwich
 * —Quito lo está—, y una persona figuraría disponible el día que empieza su reposo
 * médico.
 */
/**
 * Escribe una fecha de calendario como `AAAA-MM-DD`.
 *
 * Es la operación inversa de `aFechaUtc` y estaba escrita dos veces: en el servicio,
 * para los mensajes, y en el DTO, para la respuesta. Dos copias del mismo corte de
 * cadena que podían divergir en el momento en que una de las dos cambiara de huso.
 */
export function comoFechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

export function aFechaUtc(texto: string): Date | undefined {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) return undefined;

  const [, anio, mes, dia] = partes.map(Number);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));

  const correcta =
    fecha.getUTCFullYear() === anio &&
    fecha.getUTCMonth() === mes - 1 &&
    fecha.getUTCDate() === dia;

  return correcta ? fecha : undefined;
}
