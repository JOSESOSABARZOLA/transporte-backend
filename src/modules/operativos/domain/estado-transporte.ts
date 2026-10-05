/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: estado-transporte.ts
 * Responsabilidad: Gobernar en qué situación logística está un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * CORRIGE UN DEFECTO DEL DISEÑO PRELIMINAR (HAL-01). La Fase 2 expresaba la situación
 * con dos indicadores independientes —«transporte asignado» y «propios medios»—, que
 * admiten combinaciones sin significado: ambos ciertos a la vez. La Fase 3 los
 * sustituyó por tres estados mutuamente excluyentes, y la base lo respalda con
 * `ck_operativo_transporte`, que hace imposible guardar un operativo ASIGNADO sin
 * conductor.
 *
 * LA ALERTA SE DERIVA, NO SE GUARDA. RN-55 dice que la alerta desaparece cuando la
 * información se completa. Calcularla a partir del estado —en lugar de mantener un
 * indicador aparte— es lo que impide el defecto que hoy tiene el cuadro en Excel:
 * alertas que sobreviven a la condición que las originó.
 *
 * NO IMPORTA EL ENUMERADO DE PRISMA, a propósito. Los objetos de valor no dependen de
 * la capa de datos; los tres nombres coinciden con `e_estado_transporte` y la
 * conversión es directa, pero la dirección de la dependencia importa: el dominio no
 * cambia porque cambie el motor.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

export type EstadoTransporteValor = 'PENDIENTE' | 'ASIGNADO' | 'PROPIOS_MEDIOS';

/**
 * Transiciones admitidas, y por qué las demás no lo son.
 *
 * `PENDIENTE` significa «la DAF todavía no ha intervenido». Volver a ese estado desde
 * cualquier otro sería afirmar algo que ya no es cierto: haría reaparecer la alerta
 * amarilla como si nadie hubiera revisado el operativo, y se perdería el hecho de que
 * sí se revisó. Una corrección de la DAF se expresa cambiando entre ASIGNADO y
 * PROPIOS_MEDIOS, que son las dos formas de haber decidido.
 */
const TRANSICIONES: Record<EstadoTransporteValor, EstadoTransporteValor[]> = {
  PENDIENTE: ['ASIGNADO', 'PROPIOS_MEDIOS'],
  ASIGNADO: ['PROPIOS_MEDIOS'],
  PROPIOS_MEDIOS: ['ASIGNADO'],
};

const DESCRIPCION: Record<EstadoTransporteValor, string> = {
  PENDIENTE: 'pendiente de asignación de Transportes',
  ASIGNADO: 'con conductor y vehículo asignados',
  PROPIOS_MEDIOS: 'por propios medios',
};

export class EstadoTransporte {
  private constructor(readonly valor: EstadoTransporteValor) {}

  /** RN-40. Conductor y vehículo nacen nulos: todo operativo empieza aquí. */
  static inicial(): EstadoTransporte {
    return new EstadoTransporte('PENDIENTE');
  }

  static de(valor: string): EstadoTransporte {
    if (!(valor in TRANSICIONES)) {
      throw new ValidacionError(
        `«${valor}» no es una situación de transporte. Las situaciones son: ${Object.keys(TRANSICIONES).join(', ')}.`,
        { valor },
      );
    }
    return new EstadoTransporte(valor as EstadoTransporteValor);
  }

  /** RN-52 a RN-55. La alerta amarilla es exactamente «sigue pendiente». */
  get requiereAtencion(): boolean {
    return this.valor === 'PENDIENTE';
  }

  /** Solo ASIGNADO admite conductor y vehículo. Es `ck_operativo_transporte`. */
  get admiteConductor(): boolean {
    return this.valor === 'ASIGNADO';
  }

  puedeTransitarA(destino: EstadoTransporteValor): boolean {
    if (destino === this.valor) return true;
    return TRANSICIONES[this.valor].includes(destino);
  }

  /**
   * Aplica la transición.
   * @throws ValidacionError con un mensaje que explica por qué no se puede.
   */
  transitarA(destino: EstadoTransporteValor): EstadoTransporte {
    if (!(destino in TRANSICIONES)) {
      return EstadoTransporte.de(destino);
    }

    if (!this.puedeTransitarA(destino)) {
      throw new ValidacionError(
        `Un operativo ${DESCRIPCION[this.valor]} no puede volver a quedar ${DESCRIPCION[destino]}. Si la asignación fue un error, corríjala indicando la situación correcta.`,
        { desde: this.valor, hacia: destino },
      );
    }

    return new EstadoTransporte(destino);
  }

  equivaleA(otro: EstadoTransporte): boolean {
    return this.valor === otro.valor;
  }

  toString(): string {
    return this.valor;
  }
}
