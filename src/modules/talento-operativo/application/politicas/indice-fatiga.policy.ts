/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Políticas de descanso
 * Archivo: indice-fatiga.policy.ts
 * Responsabilidad: Puntuar la carga/fatiga de una persona y situarla en un semáforo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-24
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * ÍNDICE DE FATIGA (FRMS / ISO 45001). ES ADVISORY, NO BLOQUEA.
 *
 * Las reglas de `descanso-personal.policy.ts` deciden si una persona PUEDE salir (veredicto
 * binario que bloquea). Esta política es distinta y complementaria: sobre quien SÍ puede,
 * calcula cuánta carga acumula y la sitúa en un semáforo VERDE/ÁMBAR/ROJO para que quien
 * arma el cuadro reparta de forma equitativa. **Un ROJO sigue siendo asignable**: el operador
 * decide; el sistema solo lo hace visible y ordena la sugerencia.
 *
 * VIVE EN `talento-operativo` Y SOLO AQUÍ (regla 1 de CLAUDE.md), igual que las reglas de
 * descanso: es fatiga de personas. `transporte` y `operativos` reciben el resultado por el
 * servicio publicado, nunca reimplementan el cálculo.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ES UNA FUNCIÓN PURA. No consulta la base, no lee parámetros y no conoce NestJS: recibe los
 * factores de carga ya reunidos y los umbrales/pesos ya resueltos (de `t_parametro_politica`,
 * regla 2, nunca constantes). Así se prueba sin levantar nada, y cambiar un peso o un corte
 * altera el semáforo sin recompilar.
 */

/** Nivel del semáforo de fatiga. El equivalente textual lo pone la interfaz (regla 6). */
export type NivelFatiga = 'VERDE' | 'AMBAR' | 'ROJO';

/**
 * Los factores de carga de una persona, ya reunidos por el servicio a partir de sus
 * antecedentes (`AntecedentesPersona` + la carga del período de equidad). La política no sabe
 * de dónde salen: solo los pondera.
 */
export interface FactoresCarga {
  /** Horas ya asignadas a la persona en el día del operativo. Fatiga inmediata. */
  horasDia: number;
  /**
   * Horas que la persona ya tiene asignadas en el PERÍODO de equidad (semana/mes), en días
   * DISTINTOS al que se registra (2026-09-25). Refleja la carga acumulada del período: por eso
   * la carga de otros días de la semana "arrastra" al día que se ve. No incluye las de hoy (esas
   * ya están en `horasDia`), para no contarlas dos veces. Opcional: si no se aporta, es 0 (un
   * llamador que no mide el período —p. ej. el conductor— simplemente no lo pasa).
   */
  horasPeriodo?: number;
  /** Salidas pesadas (nocturnas o de fin de semana) acumuladas en el período de equidad. RN-25. */
  salidasPesadas: number;
  /** Si la persona salió en patrulla recientemente. Fatiga acumulada por patrulla (RN-24). */
  patrullaReciente: boolean;
}

/**
 * Umbrales y pesos leídos de `t_parametro_politica` (`FATIGA_UMBRAL_*`, `PESO_*`). Nunca
 * literales: cambiarlos calibra el motor sin desplegar.
 */
export interface UmbralesFatiga {
  umbralAmbar: number;
  umbralRojo: number;
  pesoHorasDia: number;
  /** Peso de cada hora acumulada en el período de equidad (en días distintos al de hoy). */
  pesoCargaPeriodo: number;
  pesoSalidasPesadas: number;
  pesoPatrullaReciente: number;
}

/** Lo que sale de la política: el índice, su nivel y los factores en palabras (regla 6). */
export interface IndiceFatiga {
  /** Índice compuesto, redondeado a un decimal. A mayor índice, mayor carga acumulada. */
  indice: number;
  nivel: NivelFatiga;
  /** Los factores que suman al índice, redactados; vacío si no hay carga que declarar. */
  factores: string[];
}

/** Un decimal: el índice se muestra junto al nombre, no hace falta más precisión. */
function redondear(valor: number): number {
  return Math.round(valor * 10) / 10;
}

/** «8» y no «8.0»; «6.5» tal cual. Para el factor textual de horas. */
function formatearHoras(horas: number): string {
  return Number.isInteger(horas) ? String(horas) : horas.toFixed(1);
}

/**
 * Calcula el índice de fatiga y su semáforo.
 *
 * `índice = pesoHorasDia·horasDia + pesoSalidasPesadas·salidasPesadas + pesoPatrullaReciente·(patrulla reciente)`
 *
 * El nivel se compara contra el corte ROJO primero y el ÁMBAR después: en el borde exacto de un
 * corte, gana el nivel más alto (`>=`), que es la lectura prudente para la fatiga.
 */
export function calcularFatiga(
  carga: FactoresCarga,
  umbrales: UmbralesFatiga,
): IndiceFatiga {
  const horasPeriodo = carga.horasPeriodo ?? 0;
  const porHoras = umbrales.pesoHorasDia * carga.horasDia;
  const porPeriodo = umbrales.pesoCargaPeriodo * horasPeriodo;
  const porSalidas = umbrales.pesoSalidasPesadas * carga.salidasPesadas;
  const porPatrulla = carga.patrullaReciente
    ? umbrales.pesoPatrullaReciente
    : 0;

  const indice = redondear(porHoras + porPeriodo + porSalidas + porPatrulla);

  const nivel: NivelFatiga =
    indice >= umbrales.umbralRojo
      ? 'ROJO'
      : indice >= umbrales.umbralAmbar
        ? 'AMBAR'
        : 'VERDE';

  const factores: string[] = [];
  if (carga.horasDia > 0) {
    factores.push(`${formatearHoras(carga.horasDia)} h ya asignadas hoy`);
  }
  if (horasPeriodo > 0) {
    factores.push(
      `${formatearHoras(horasPeriodo)} h más en el período (otros días)`,
    );
  }
  if (carga.salidasPesadas > 0) {
    factores.push(
      `${carga.salidasPesadas} salida${carga.salidasPesadas === 1 ? '' : 's'} pesada${
        carga.salidasPesadas === 1 ? '' : 's'
      } en el período`,
    );
  }
  if (carga.patrullaReciente) {
    factores.push('salió en patrulla recientemente');
  }

  return { indice, nivel, factores };
}

/** Nivel de EQUIDAD del reparto de una persona frente a la cuota justa del grupo. */
export type NivelEquidad = 'DEBAJO' | 'EQUILIBRADO' | 'ENCIMA';

/** Resultado de la señal de equidad: la parte justa, la desviación y el nivel. */
export interface Equidad {
  /** Cuota justa = carga total del grupo / nº de personas. La «parte» que le tocaría a cada una. */
  cuotaJusta: number;
  /** Carga de la persona menos su cuota justa. Positivo = por encima de su parte. */
  desviacion: number;
  nivel: NivelEquidad;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SEÑAL DE EQUIDAD (reparto), SEPARADA DE LA FATIGA (seguridad).
 *
 * `calcularFatiga` responde una pregunta de SEGURIDAD —¿esta persona está cerca de un límite de
 * fatiga?— con umbrales ABSOLUTOS; su color no depende del grupo. Esta función responde otra
 * distinta —¿está cargando más o menos que su PARTE JUSTA?— comparando su carga con la CUOTA JUSTA,
 * que es la media del grupo. No mide seguridad ni posición relativa por tercios: mide reparto.
 *
 * `margen` es la banda (fracción) alrededor de la cuota dentro de la cual se considera EQUILIBRADO;
 * por encima, ENCIMA; por debajo, DEBAJO. Con cuota 0 —nadie carga— no hay parte que repartir, así
 * que todos quedan EQUILIBRADO. Es una función PURA, como `calcularFatiga`: recibe la cuota ya
 * calculada y el margen ya resuelto (de `EQUIDAD_MARGEN`, regla 2), nunca una constante.
 * ═══════════════════════════════════════════════════════════════════════════════
 */
export function clasificarEquidad(
  carga: number,
  cuotaJusta: number,
  margen: number,
): Equidad {
  const desviacion = redondear(carga - cuotaJusta);

  if (cuotaJusta <= 0) {
    return {
      cuotaJusta: redondear(cuotaJusta),
      desviacion,
      nivel: 'EQUILIBRADO',
    };
  }

  const ratio = carga / cuotaJusta;
  const nivel: NivelEquidad =
    ratio > 1 + margen
      ? 'ENCIMA'
      : ratio < 1 - margen
        ? 'DEBAJO'
        : 'EQUILIBRADO';

  return { cuotaJusta: redondear(cuotaJusta), desviacion, nivel };
}
