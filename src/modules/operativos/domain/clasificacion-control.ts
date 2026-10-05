/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Operativos
 * Archivo: clasificacion-control.ts
 * Responsabilidad: Representar qué se controla en un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-06
 *
 * RN-16 y RN-20 · INV-08. Es la SEGUNDA MITAD del patrón que `UbicacionOperativa`
 * abrió en M-09, y que FASE3 §OV-03 pide modelar de forma consistente: la dualidad
 * catálogo/captura libre aparece dos veces en el dominio —punto de encuentro y tipo de
 * control— y merece la misma forma en ambos sitios.
 *
 * `ck_operativo_tipo` exige que esté informado **exactamente uno** de los dos. Se
 * comprueba aquí para que el funcionario lea una frase y no el error del motor.
 *
 * LA DIFERENCIA CON EL PUNTO. ADICIONALES no es una fila del catálogo (INV-08), y no
 * todos los formularios la ofrecen: `form_permite_captura_libre` dice cuáles, y es dato
 * del insumo aprobado —los formularios 2 y 8—, no una suposición. Por eso la captura
 * libre recibe ese permiso como parámetro: quien construye el objeto tiene que haberlo
 * consultado.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

/** De dónde salió el tipo de control. RN-20. */
export type OrigenTipoControl = 'CATALOGO' | 'CAPTURA_LIBRE';

/** `oper_tipo_libre` admite 220 caracteres. */
const LARGO_MAXIMO_LIBRE = 220;

export class ClasificacionControl {
  private constructor(
    readonly tipoId: number | null,
    readonly tipoLibre: string | null,
    /**
     * Varios tipos del catálogo, SOLO donde el formulario admite selección múltiple
     * (form 8). En el resto va vacío y el tipo único viaja en `tipoId`. Es la mitad de N:M
     * que `t_operativo_tipo_control` guarda.
     */
    readonly tipoIds: number[] = [],
  ) {}

  /** Tipo elegido del catálogo delimitado del formulario. */
  static delCatalogo(tipoId: number): ClasificacionControl {
    ClasificacionControl.exigirIdValido(tipoId);
    return new ClasificacionControl(tipoId, null);
  }

  /**
   * RN-20. Tipo capturado como adicional.
   *
   * @param permiteCapturaLibre si el formulario ofrece la opción ADICIONALES
   */
  static capturada(
    descripcion: string,
    permiteCapturaLibre: boolean,
  ): ClasificacionControl {
    return new ClasificacionControl(
      null,
      ClasificacionControl.exigirLibreValido(descripcion, permiteCapturaLibre),
    );
  }

  /**
   * Varios tipos del catálogo a la vez, más —opcional— un adicional de texto libre. Solo
   * donde el formulario lo admite (form 8). Exige AL MENOS UN tipo en total: la garantía
   * que el CHECK ya no puede dar —los tipos viven en otra tabla— vive aquí.
   */
  static multiple(datos: {
    tipoIds?: number[] | null;
    tipoLibre?: string | null;
    permiteCapturaLibre: boolean;
  }): ClasificacionControl {
    const ids = [
      ...new Set(
        (datos.tipoIds ?? []).filter(
          (id): id is number => id !== null && id !== undefined,
        ),
      ),
    ];
    ids.forEach((id) => ClasificacionControl.exigirIdValido(id));

    const tieneLibre =
      datos.tipoLibre !== null &&
      datos.tipoLibre !== undefined &&
      datos.tipoLibre.trim().length > 0;
    const libre = tieneLibre
      ? ClasificacionControl.exigirLibreValido(
          datos.tipoLibre as string,
          datos.permiteCapturaLibre,
        )
      : null;

    if (ids.length === 0 && libre === null) {
      throw new ValidacionError(
        'Elija al menos un tipo de control del operativo.',
        {},
      );
    }

    return new ClasificacionControl(null, libre, ids);
  }

  /**
   * Construye desde datos sueltos, como llegan de un DTO o de la base.
   *
   * Con `permiteMultiple` (form 8) admite varios tipos y un adicional a la vez. Sin él es
   * el patrón de siempre: exactamente uno de catálogo o captura libre, nunca los dos ni
   * ninguno. Misma forma que `UbicacionOperativa.de`.
   */
  static de(datos: {
    tipoId?: number | null;
    tipoIds?: number[] | null;
    tipoLibre?: string | null;
    permiteCapturaLibre: boolean;
    permiteMultiple?: boolean;
  }): ClasificacionControl {
    if (datos.permiteMultiple) {
      return ClasificacionControl.multiple(datos);
    }

    const tieneTipo = datos.tipoId !== null && datos.tipoId !== undefined;
    const tieneLibre =
      datos.tipoLibre !== null &&
      datos.tipoLibre !== undefined &&
      datos.tipoLibre.trim().length > 0;

    if (tieneTipo && tieneLibre) {
      throw new ValidacionError(
        'Elija un tipo de control del catálogo o escriba uno como adicional, pero no las dos cosas.',
        { tipoId: datos.tipoId, tipoLibre: datos.tipoLibre },
      );
    }

    if (!tieneTipo && !tieneLibre) {
      throw new ValidacionError(
        'Indique el tipo de control del operativo.',
        {},
      );
    }

    return tieneTipo
      ? ClasificacionControl.delCatalogo(datos.tipoId as number)
      : ClasificacionControl.capturada(
          datos.tipoLibre as string,
          datos.permiteCapturaLibre,
        );
  }

  private static exigirIdValido(tipoId: number): void {
    if (!Number.isInteger(tipoId) || tipoId <= 0) {
      throw new ValidacionError(
        'El tipo de control seleccionado no es válido.',
        { tipoId },
      );
    }
  }

  private static exigirLibreValido(
    descripcion: string,
    permiteCapturaLibre: boolean,
  ): string {
    if (!permiteCapturaLibre) {
      throw new ValidacionError(
        'Este formulario no ofrece la opción ADICIONALES: elija un tipo de control del catálogo.',
        {},
      );
    }

    const texto = descripcion.trim();

    if (texto.length === 0) {
      throw new ValidacionError(
        'Indique el tipo de control. Al elegir ADICIONALES hay que escribir cuál es.',
        {},
      );
    }

    if (texto.length > LARGO_MAXIMO_LIBRE) {
      throw new ValidacionError(
        `El tipo de control adicional no puede superar los ${LARGO_MAXIMO_LIBRE} caracteres.`,
        { largo: texto.length },
      );
    }

    return texto;
  }

  get origen(): OrigenTipoControl {
    return this.tipoId !== null || this.tipoIds.length > 0
      ? 'CATALOGO'
      : 'CAPTURA_LIBRE';
  }

  equivaleA(otra: ClasificacionControl): boolean {
    return (
      this.tipoId === otra.tipoId &&
      this.tipoLibre === otra.tipoLibre &&
      this.tipoIds.length === otra.tipoIds.length &&
      [...this.tipoIds]
        .sort()
        .every((id, i) => id === [...otra.tipoIds].sort()[i])
    );
  }
}
