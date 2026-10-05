/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: dato-aislado.ts
 * Responsabilidad: Construir el contenido de la orden, cerrado por construcción.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * POL-09 · INV-24 · RN-50. ES LA RAZÓN DE SER DEL MÓDULO.
 *
 * La orden de servicio expone **exclusivamente horario, funcionario, conductor y placa**.
 * El motivo lo declara RN-51 sin rodeos: la filtración del cuadro permitía a los
 * intervenidos anticiparse al operativo.
 *
 * ESTE OBJETO NO RECIBE EL OPERATIVO NI LO REFERENCIA. Recibe cuatro valores sueltos y
 * devuelve un objeto cerrado. La diferencia no es de estilo:
 *
 *   · Si recibiera el operativo, omitir un campo dependería de **recordar** omitirlo, y
 *     cualquiera que mañana agregue una columna al modelo la filtraría sin darse cuenta.
 *   · Recibiendo cuatro valores, **no hay nada más que filtrar**. La fuga es
 *     estructuralmente imposible, no una disciplina que haya que sostener.
 *
 * FASE3 §OV-24 lo dice igual: «cerrado por construcción. Garantiza INV-24».
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * NO CONOCE PRISMA, NI NESTJS, NI EL RESTO DEL SISTEMA. Está en `domain/` precisamente
 * porque no debe poder alcanzar nada desde aquí.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

/** El conductor asignado, o la razón por la que no lo hay. */
export interface ConductorDelDato {
  nombre: string;
  /** El funcionario tiene que poder llamarlo. FASE5 §9.6 lo muestra en la tarjeta. */
  telefono: string | null;
}

/**
 * El contenido íntegro de una orden de servicio. **Cuatro campos y ninguno más.**
 *
 * `readonly` en todos: una vez construido no se modifica, que es lo que INV-25 exige del
 * documento emitido.
 */
export interface DatoAislado {
  readonly horario: string;
  readonly funcionario: string;
  readonly conductor: ConductorDelDato | null;
  readonly placa: string | null;
}

/** Los cuatro valores, sueltos. Nótese que aquí no cabe un operativo. */
export interface ValoresDeLaOrden {
  horaInicio: string;
  horaFin: string;
  nombreFuncionario: string;
  nombreConductor?: string | null;
  telefonoConductor?: string | null;
  placa?: string | null;
}

/**
 * Construye el dato aislado. POL-09.
 *
 * @throws ValidacionError si falta el horario o el nombre del destinatario, que son los
 *         dos únicos campos sin los cuales el documento no dice nada.
 */
export function construirDatoAislado(valores: ValoresDeLaOrden): DatoAislado {
  const horario = componerHorario(valores.horaInicio, valores.horaFin);
  const funcionario = valores.nombreFuncionario.trim();

  if (funcionario.length === 0) {
    throw new ValidacionError(
      'La orden de servicio necesita el nombre del funcionario al que se entrega.',
      {},
    );
  }

  // El objeto se congela: ni siquiera por descuido se le puede añadir un quinto campo
  // después de construirlo. Es la última vuelta de tuerca de INV-24 e INV-25.
  return Object.freeze({
    horario,
    funcionario,
    conductor: valores.nombreConductor
      ? Object.freeze({
          nombre: valores.nombreConductor,
          telefono: valores.telefonoConductor ?? null,
        })
      : null,
    placa: valores.placa ?? null,
  });
}

/**
 * Comprueba que un dato ya guardado siga teniendo exactamente los cuatro campos.
 *
 * Sirve al leer lo que se emitió hace meses: si alguien hubiera escrito en la columna
 * JSONB por fuera del sistema, esto lo detecta antes de imprimirlo.
 */
export function esDatoAisladoValido(valor: unknown): valor is DatoAislado {
  if (typeof valor !== 'object' || valor === null) return false;

  const claves = Object.keys(valor).sort();
  const esperadas = ['conductor', 'funcionario', 'horario', 'placa'];

  return (
    claves.length === esperadas.length &&
    claves.every((clave, indice) => clave === esperadas[indice])
  );
}

/** `18:00` y `23:30` → `18H00 A 23H30`. La notación institucional del cuadro. */
function componerHorario(horaInicio: string, horaFin: string): string {
  const patron = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

  if (!patron.test(horaInicio) || !patron.test(horaFin)) {
    throw new ValidacionError(
      'La orden de servicio necesita el horario del operativo.',
      { horaInicio, horaFin },
    );
  }

  return `${horaInicio.replace(':', 'H')} A ${horaFin.replace(':', 'H')}`;
}
