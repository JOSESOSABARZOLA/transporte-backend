/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: resolver-tokens.ts
 * Responsabilidad: UNA sola función que resuelve los tokens del documento y dice qué falta.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-02
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UNA SOLA VERDAD PARA LOS DATOS Y LOS FALTANTES (D12).
 *
 * `resolverTokens(apartados, fuente)` devuelve los VALORES de cada token y la lista de FALTANTES, y
 * la usan TODOS los sitios donde antes se resolvía por separado: la generación del PDF, la
 * previsualización, el estado/chip, la tarjeta, el visor y la validación de emisión. Para la misma
 * persona, todos obtienen EXACTAMENTE los mismos faltantes.
 *
 * REGLAS:
 *  · D15: un token es OBLIGATORIO solo si la plantilla lo usa (aparece como {{token}} en algún
 *    apartado), SALVO los estructurales que el documento siempre muestra (cargo/dependencia del
 *    destinatario y NUT) y el firmante (cargo/dependencia), que se exigen siempre.
 *  · D14: `numeroOrden` NUNCA es faltante (se asigna al quedar Vigente); los demás vacíos se pintan
 *    como `[Etiqueta]` resaltado (el exportador), nunca «XXXX».
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Un apartado de la plantilla, en lo que hace falta para escanear sus tokens. */
export interface ApartadoConTokens {
  titulo: string;
  etiqueta?: string;
  contenido: string;
}

/**
 * Los valores ya resueltos de cada dato (cadena vacía = sin completar). `numeroOrden` es nulo
 * mientras la orden es Borrador. `firmanteCargo`/`firmanteDependencia` no son tokens del cuerpo:
 * alimentan el bloque de firma y se exigen siempre (F22).
 */
export interface FuenteTokens {
  nombre: string;
  cargo: string;
  dependencia: string;
  fechaEmision: string;
  ciudadFecha: string;
  direccionResponsable: string;
  siglasUnidad: string;
  numeroMemorando: string;
  /** Fecha del memorando de designación, ya en lenguaje natural («17 de junio de 2026»). Plantilla. */
  fechaMemorando: string;
  /** Funcionario designado (nombre y cargo), tras «asignó al». Sale de los datos generales (plantilla). */
  designado: string;
  nut: string;
  elaboradoPor: string;
  firmante: string;
  firmanteCargo: string;
  firmanteDependencia: string;
  numeroOrden: string | null;
}

/** Los doce tokens del cuerpo y su etiqueta legible (para el `[placeholder]` y los faltantes). */
export const ETIQUETA_TOKEN: Record<string, string> = {
  nombre: 'Nombre',
  cargo: 'Cargo del destinatario',
  dependencia: 'Dependencia del destinatario',
  fechaEmision: 'Fecha de emisión',
  ciudadFecha: 'Ciudad y fecha',
  direccionResponsable: 'Dirección responsable',
  siglasUnidad: 'Siglas de la unidad',
  numeroMemorando: 'Número de memorando',
  fechaMemorando: 'Fecha del memorando',
  designado: 'Funcionario designado',
  nut: 'NUT',
  elaboradoPor: 'Elaborado por',
  firmante: 'Firmante',
  firmanteCargo: 'Cargo del firmante',
  firmanteDependencia: 'Dependencia del firmante',
  numeroOrden: 'Número de orden',
};

/**
 * De DÓNDE sale cada dato (D16), para AGRUPAR los faltantes en el aviso de borrador (E21). Desde la
 * plantilla por Director (2026-10-05) son cinco orígenes:
 *  · `persona`: de la ficha de Personal del destinatario (nombre, cargo, dependencia).
 *  · `plantilla`: de los DATOS GENERALES de la plantilla del Director: dirección responsable,
 *     número y fecha del memorando de designación y funcionario designado.
 *  · `firmante`: el bloque de firma —nombre, cargo y dependencia— que también vive en los datos
 *     generales de la plantilla del Director, pero se agrupa aparte porque es lo que firma.
 *  · `cuadro`: de la config del DÍA (NUT y «elaborado por»), compartida por las órdenes de la jornada.
 *  · `configuracion`: de los parámetros globales administrables (siglas de la unidad).
 */
export type OrigenFaltante =
  | 'persona'
  | 'plantilla'
  | 'firmante'
  | 'cuadro'
  | 'configuracion';

const ORIGEN_TOKEN: Record<string, OrigenFaltante> = {
  nombre: 'persona',
  cargo: 'persona',
  dependencia: 'persona',
  numeroMemorando: 'plantilla',
  fechaMemorando: 'plantilla',
  designado: 'plantilla',
  direccionResponsable: 'plantilla',
  firmante: 'firmante',
  firmanteCargo: 'firmante',
  firmanteDependencia: 'firmante',
  nut: 'cuadro',
  elaboradoPor: 'cuadro',
  siglasUnidad: 'configuracion',
};

/** Un dato obligatorio que falta, con su etiqueta legible y su origen (para agrupar, E21). */
export interface Faltante {
  token: string;
  etiqueta: string;
  origen: OrigenFaltante;
}

/**
 * Estructurales: el documento SIEMPRE los muestra, así que se exigen aunque la plantilla no los
 * nombre: el bloque PARA (cargo/dependencia del destinatario), el NUT y el bloque de firma
 * (nombre, cargo y dependencia del firmante). El resto solo si la plantilla los usa (D15).
 * `numeroOrden` nunca.
 */
const SIEMPRE_REQUERIDOS = new Set([
  'cargo',
  'dependencia',
  'nut',
  'firmante',
  'firmanteCargo',
  'firmanteDependencia',
]);

/**
 * Nunca son faltantes: `numeroOrden` se asigna al quedar Vigente (D14); `ciudadFecha` y
 * `fechaEmision` se CALCULAN de la fecha (D16), así que siempre tienen valor.
 */
const NUNCA_FALTANTE = new Set(['numeroOrden', 'ciudadFecha', 'fechaEmision']);

function vacio(valor: string | null | undefined): boolean {
  return typeof valor !== 'string' || valor.trim() === '';
}

/** Los tokens `{{...}}` que usa la plantilla (en título, etiqueta o contenido de cualquier apartado). */
export function tokensUsados(apartados: ApartadoConTokens[]): Set<string> {
  const usados = new Set<string>();
  const patron = /\{\{\s*(\w+)\s*\}\}/g;
  for (const apartado of apartados) {
    for (const texto of [
      apartado.titulo,
      apartado.etiqueta ?? '',
      apartado.contenido,
    ]) {
      let coincidencia: RegExpExecArray | null;
      patron.lastIndex = 0;
      while ((coincidencia = patron.exec(texto)) !== null) {
        usados.add(coincidencia[1]);
      }
    }
  }
  return usados;
}

/** El resultado de resolver: el valor de cada token y qué datos obligatorios faltan (por origen). */
export interface ResolucionTokens {
  valores: Record<string, string | null>;
  faltantes: Faltante[];
}

/**
 * Resuelve los valores de los tokens y calcula los faltantes con las reglas D14/D15. Es PURA: recibe
 * los datos ya buscados (la fuente) y la plantilla, y no toca la base ni el reloj.
 */
export function resolverTokens(
  apartados: ApartadoConTokens[],
  fuente: FuenteTokens,
): ResolucionTokens {
  const usados = tokensUsados(apartados);

  const valores: Record<string, string | null> = {
    nombre: fuente.nombre,
    cargo: fuente.cargo,
    dependencia: fuente.dependencia,
    fechaEmision: fuente.fechaEmision,
    ciudadFecha: fuente.ciudadFecha,
    direccionResponsable: fuente.direccionResponsable,
    siglasUnidad: fuente.siglasUnidad,
    numeroMemorando: fuente.numeroMemorando,
    fechaMemorando: fuente.fechaMemorando,
    designado: fuente.designado,
    nut: fuente.nut,
    elaboradoPor: fuente.elaboradoPor,
    firmante: fuente.firmante,
    firmanteCargo: fuente.firmanteCargo,
    firmanteDependencia: fuente.firmanteDependencia,
    numeroOrden: fuente.numeroOrden,
  };

  const faltantes: Faltante[] = [];

  // El bloque de firma (nombre, cargo y dependencia del firmante) es estructural: el bucle genérico
  // lo cubre por `SIEMPRE_REQUERIDOS`, con origen 'firmante'.
  for (const token of Object.keys(ETIQUETA_TOKEN)) {
    if (NUNCA_FALTANTE.has(token)) continue; // numeroOrden/ciudadFecha/fechaEmision (D14/D16).
    const requerido = usados.has(token) || SIEMPRE_REQUERIDOS.has(token);
    if (requerido && vacio(valores[token])) {
      faltantes.push({
        token,
        etiqueta: ETIQUETA_TOKEN[token],
        origen: ORIGEN_TOKEN[token] ?? 'configuracion',
      });
    }
  }

  return { valores, faltantes };
}
