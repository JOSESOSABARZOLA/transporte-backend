/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-alertas.policy.ts
 * Responsabilidad: Avisar, entre días consecutivos, de rachas sin descanso y de diurno tras nocturno.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * SOLO AVISA, NUNCA BLOQUEA. La matriz de Instrucción la arma su administrador, y estos avisos le
 * dicen dónde mirar; quién puede salir lo sigue decidiendo `descanso-personal.policy.ts`.
 *
 * DOS REGLAS, LAS DOS POR PARÁMETRO (regla 2) Y APAGADAS HASTA QUE SE CONFIGUREN:
 *   · `COBERTURA_MAX_DIAS_SIN_DESCANSO`: más días seguidos trabajados (D o N) que este máximo
 *     avisa en cada día que lo excede. 0 = no se evalúa.
 *   · `COBERTURA_PERMITE_NOCTURNO_A_DIURNO`: con NO, un DIURNO al día siguiente de un NOCTURNO
 *     avisa. SI o SIN_CONFIGURAR = no se evalúa.
 *
 * LAS AUSENCIAS Y LAS CELDAS VACÍAS CORTAN LA RACHA: no son días trabajados, y una celda vacía es
 * un día que nadie planificó, no uno que se trabajó.
 *
 * ES PURA: recibe la secuencia de días de UNA persona ya resuelta (con días previos al mes si se
 * quiere que la racha arrastre) y devuelve un aviso por posición.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Lo que un día significa para los avisos. */
export type DiaAviso =
  | 'DIURNO'
  | 'NOCTURNO'
  | 'DESCANSO'
  | 'VACIA'
  | 'AUSENCIA';

/** Valores admitidos del parámetro de nocturno → diurno. */
export const VALORES_NOCTURNO_A_DIURNO = [
  'SIN_CONFIGURAR',
  'SI',
  'NO',
] as const;
export type ValorNocturnoADiurno = (typeof VALORES_NOCTURNO_A_DIURNO)[number];

export interface ParametrosAvisosCobertura {
  /** 0 = no se evalúa. */
  maxDiasSinDescanso: number;
  permiteNocturnoADiurno: ValorNocturnoADiurno;
}

/** Interpreta el texto del parámetro; cualquier valor desconocido se trata como SIN_CONFIGURAR. */
export function comoValorNocturnoADiurno(texto: string): ValorNocturnoADiurno {
  const limpio = texto.trim().toUpperCase();
  return (VALORES_NOCTURNO_A_DIURNO as readonly string[]).includes(limpio)
    ? (limpio as ValorNocturnoADiurno)
    : 'SIN_CONFIGURAR';
}

/** ¿Hay alguna regla de aviso encendida? Si no, la UI no muestra el contador de avisos. */
export function avisosConfigurados(
  parametros: ParametrosAvisosCobertura,
): boolean {
  return (
    parametros.maxDiasSinDescanso > 0 ||
    parametros.permiteNocturnoADiurno !== 'SIN_CONFIGURAR'
  );
}

const trabaja = (dia: DiaAviso): boolean =>
  dia === 'DIURNO' || dia === 'NOCTURNO';

/**
 * Un aviso (o `undefined`) por cada día de la secuencia. Si un día cumple las dos reglas, los dos
 * textos se juntan.
 */
export function calcularAvisosCobertura(
  dias: readonly DiaAviso[],
  parametros: ParametrosAvisosCobertura,
): (string | undefined)[] {
  const evaluaRacha = parametros.maxDiasSinDescanso > 0;
  const evaluaNocturno = parametros.permiteNocturnoADiurno === 'NO';

  let racha = 0;

  return dias.map((dia, indice) => {
    const avisos: string[] = [];

    racha = trabaja(dia) ? racha + 1 : 0;
    if (evaluaRacha && racha > parametros.maxDiasSinDescanso) {
      avisos.push(
        `${racha} días seguidos sin descanso (máximo ${parametros.maxDiasSinDescanso})`,
      );
    }

    if (evaluaNocturno && dia === 'DIURNO' && dias[indice - 1] === 'NOCTURNO') {
      avisos.push('Turno diurno al día siguiente de uno nocturno');
    }

    return avisos.length > 0 ? avisos.join(' · ') : undefined;
  });
}
