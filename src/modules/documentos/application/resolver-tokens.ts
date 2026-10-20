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
 *    apartado), SALVO los estructurales que el documento siempre muestra (la dependencia del
 *    destinatario, el firmante y la tabla de control —«elaborado por» y siglas—), que se exigen
 *    siempre. El NUT dejó de existir el 2026-10-08. El CARGO del destinatario sale de su ficha y,
 *    si no lo tiene, va en blanco: nunca es faltante (2026-10-08).
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
  /** Quién elabora: tabla de control del final, de los datos generales de la plantilla (2026-10-08). */
  elaboradoPor: string;
  firmante: string;
  firmanteCargo: string;
  firmanteDependencia: string;
  numeroOrden: string | null;
  /**
   * La orden se resuelve con una versión de plantilla ANTERIOR a la tabla de control (2026-10-08):
   * «elaborado por» y siglas llegan del respaldo (config del día y parámetro) y se exigen solo si la
   * plantilla los usa, como entonces. Así una orden Vigente no pasa a Borrador por este cambio.
   */
  tablaControlLegada?: boolean;
  /**
   * Trámite(s) de Inspección de la persona en la jornada (2026-10-07): la COPIA guardada al
   * registrar el operativo. Si tiene varios en el día, van unidos por «; ». Vacíos si no tiene.
   * Opcionales porque solo el documento real los carga; los demás sitios no los necesitan.
   */
  tramiteCodigo?: string;
  tramiteSitra?: string;
  tramitePredio?: string;
  tramiteZonal?: string;
  tramiteMateria?: string;
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
  elaboradoPor: 'Elaborado por',
  firmante: 'Firmante',
  firmanteCargo: 'Cargo del firmante',
  firmanteDependencia: 'Dependencia del firmante',
  numeroOrden: 'Número de orden',
  // Trámite de Inspección (2026-10-07). Sin punto en el nombre: el patrón de tokens es \w+.
  tramiteCodigo: 'Código del trámite de Inspección',
  tramiteSitra: 'N.º SITRA del trámite',
  tramitePredio: 'Predio del trámite',
  tramiteZonal: 'Zonal del trámite',
  tramiteMateria: 'Materia del trámite',
};

/**
 * De DÓNDE sale cada dato (D16), para AGRUPAR los faltantes en el aviso de borrador (E21). Desde la
 * tabla de control en la plantilla (2026-10-08) son cuatro orígenes:
 *  · `persona`: de la ficha de Personal del destinatario (nombre, cargo, dependencia).
 *  · `plantilla`: de los DATOS GENERALES de la plantilla del Director: dirección responsable,
 *     número y fecha del memorando de designación, funcionario designado y la tabla de control
 *     («elaborado por» y siglas de la unidad).
 *  · `firmante`: el bloque de firma —nombre, cargo y dependencia— que también vive en los datos
 *     generales de la plantilla del Director, pero se agrupa aparte porque es lo que firma.
 *  · `configuracion`: de los parámetros globales administrables (el respaldo de las versiones de
 *     plantilla anteriores a la tabla de control).
 * El origen `cuadro` (config del DÍA: NUT y «elaborado por») se retiró el 2026-10-08.
 */
export type OrigenFaltante =
  | 'persona'
  | 'plantilla'
  | 'firmante'
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
  elaboradoPor: 'plantilla',
  siglasUnidad: 'plantilla',
};

/** Un dato obligatorio que falta, con su etiqueta legible y su origen (para agrupar, E21). */
export interface Faltante {
  token: string;
  etiqueta: string;
  origen: OrigenFaltante;
}

/**
 * Estructurales: el documento SIEMPRE los muestra, así que se exigen aunque la plantilla no los
 * nombre: la dependencia del destinatario, el bloque de firma (nombre, cargo y
 * dependencia del firmante) y la tabla de control del final («elaborado por» y siglas, 2026-10-08).
 * El resto solo si la plantilla los usa (D15). `numeroOrden` nunca.
 */
const SIEMPRE_REQUERIDOS = new Set([
  'dependencia',
  'firmante',
  'firmanteCargo',
  'firmanteDependencia',
  'elaboradoPor',
  'siglasUnidad',
]);

/** Los de la tabla de control: con una versión de plantilla anterior se exigen solo si se usan. */
const DE_LA_TABLA_DE_CONTROL = new Set(['elaboradoPor', 'siglasUnidad']);

/**
 * Nunca son faltantes: `numeroOrden` se asigna al quedar Vigente (D14); `ciudadFecha` y
 * `fechaEmision` se CALCULAN de la fecha (D16), así que siempre tienen valor.
 */
const NUNCA_FALTANTE = new Set([
  'numeroOrden',
  'ciudadFecha',
  'fechaEmision',
  // El cargo del destinatario sale de su ficha de Personal; si no lo tiene, va EN BLANCO
  // (2026-10-08): ni deja la orden en borrador ni se pide por orden, aunque la plantilla use {{cargo}}.
  'cargo',
  // El trámite de Inspección (2026-10-07) solo lo tienen los inspectores que lo eligieron: si la
  // plantilla lo usa, a quien no tiene se le pinta `[Etiqueta]`, pero NO deja su orden en borrador.
  'tramiteCodigo',
  'tramiteSitra',
  'tramitePredio',
  'tramiteZonal',
  'tramiteMateria',
]);

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
    elaboradoPor: fuente.elaboradoPor,
    firmante: fuente.firmante,
    firmanteCargo: fuente.firmanteCargo,
    firmanteDependencia: fuente.firmanteDependencia,
    numeroOrden: fuente.numeroOrden,
    tramiteCodigo: fuente.tramiteCodigo ?? '',
    tramiteSitra: fuente.tramiteSitra ?? '',
    tramitePredio: fuente.tramitePredio ?? '',
    tramiteZonal: fuente.tramiteZonal ?? '',
    tramiteMateria: fuente.tramiteMateria ?? '',
  };

  const faltantes: Faltante[] = [];

  // El bloque de firma (nombre, cargo y dependencia del firmante) es estructural: el bucle genérico
  // lo cubre por `SIEMPRE_REQUERIDOS`, con origen 'firmante'.
  for (const token of Object.keys(ETIQUETA_TOKEN)) {
    if (NUNCA_FALTANTE.has(token)) continue; // numeroOrden/ciudadFecha/fechaEmision (D14/D16).
    const estructural =
      SIEMPRE_REQUERIDOS.has(token) &&
      !(fuente.tablaControlLegada && DE_LA_TABLA_DE_CONTROL.has(token));
    const requerido = usados.has(token) || estructural;
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
