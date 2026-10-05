/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Objetos de valor del dominio
 * Archivo: ubicacion-operativa.ts
 * Responsabilidad: Representar dónde ocurre un operativo.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * RN-17 a RN-20. Reúne las zonales del operativo y su punto de encuentro.
 *
 * DOS REGLAS QUE LA BASE YA IMPONE, Y QUE AQUÍ SE COMPRUEBAN ANTES:
 *
 *   · `ck_operativo_punto` exige que esté informado **exactamente uno** de los dos
 *     puntos: el del catálogo o el capturado libremente. Ni los dos, ni ninguno.
 *   · RN-19 admite que un operativo abarque varias zonales cuando la jornada se
 *     reparte, pero nunca ninguna: sin zonal no se sabe dónde ocurre.
 *
 * Comprobarlo aquí no duplica la restricción: la anticipa. Sin esto, el funcionario
 * recibiría el error del motor en lugar de una frase que le diga qué corregir.
 *
 * LA DUALIDAD CATÁLOGO/LIBRE APARECE DOS VECES en el dominio —punto de encuentro y
 * tipo de control—. FASE3 §OV-03 recomienda modelarla como un patrón consistente; este
 * objeto es la primera mitad, y `ClasificacionControl` de M-14 seguirá la misma forma.
 */

import { ValidacionError } from '../../../common/errors/errores-dominio';

/** De dónde salió el punto de encuentro. RN-20. */
export type OrigenPunto = 'CATALOGO' | 'CAPTURA_LIBRE';

export class UbicacionOperativa {
  private constructor(
    readonly zonalIds: readonly number[],
    readonly puntoId: number | null,
    readonly puntoLibre: string | null,
  ) {}

  /** Punto elegido del catálogo delimitado del formulario. */
  static enPuntoDelCatalogo(
    zonalIds: number[],
    puntoId: number,
  ): UbicacionOperativa {
    exigirZonales(zonalIds);

    if (!Number.isInteger(puntoId) || puntoId <= 0) {
      throw new ValidacionError(
        'El punto de encuentro seleccionado no es válido.',
        { puntoId },
      );
    }

    return new UbicacionOperativa(normalizar(zonalIds), puntoId, null);
  }

  /**
   * PUNTO POR CREAR dentro de la transacción del registro (Unidad de Operativos, 2026-09-24).
   *
   * Aquí solo viajan las zonales: el punto todavía NO existe —se crea en el catálogo dentro de
   * la MISMA transacción del operativo (regla 5), y su identificador se rellena al insertarlo—.
   * No se escribe un operativo directamente desde este estado: `ck_operativo_punto` exige el
   * punto, y el registro pone el identificador del punto recién creado antes de insertar. Sirve
   * para validar las zonales del operativo sin tener aún el punto. Ver `OperativosService.registrar`.
   */
  static conPuntoPorCrear(zonalIds: number[]): UbicacionOperativa {
    exigirZonales(zonalIds);
    return new UbicacionOperativa(normalizar(zonalIds), null, null);
  }

  /** RN-20. Punto capturado como adicional, con texto libre. */
  static enPuntoLibre(
    zonalIds: number[],
    descripcion: string,
  ): UbicacionOperativa {
    exigirZonales(zonalIds);

    const texto = descripcion.trim();
    if (texto.length === 0) {
      throw new ValidacionError(
        'Indique el punto de encuentro. Al elegir ADICIONALES hay que escribir cuál es.',
        {},
      );
    }

    return new UbicacionOperativa(normalizar(zonalIds), null, texto);
  }

  /**
   * Construye desde datos sueltos, como llegan de un DTO o de la base.
   *
   * Es el punto donde se rechaza la combinación imposible: los dos puntos informados,
   * o ninguno.
   */
  static de(datos: {
    zonalIds: number[];
    puntoId?: number | null;
    puntoLibre?: string | null;
    /**
     * RN-20. Si el catálogo de puntos de este formulario ofrece ADICIONALES.
     *
     * AGREGADO EL 2026-08-11, y cierra un hueco real. `ClasificacionControl` recibía la
     * bandera desde M-14 y rechazaba un tipo de control libre donde no correspondía;
     * este objeto no la recibía, así que **el servidor aceptaba un punto de encuentro
     * capturado libremente en cualquiera de los nueve formularios**, incluidos los que
     * no ofrecen la opción. La interfaz lo tapaba ofreciéndola solo donde tocaba, pero
     * una petición directa entraba sin obstáculo.
     *
     * La cabecera de este archivo ya anunciaba la simetría: «este objeto es la primera
     * mitad, y `ClasificacionControl` seguirá la misma forma». Faltaba la mitad.
     */
    capturaLibrePermitida: boolean;
  }): UbicacionOperativa {
    const tienePunto = datos.puntoId !== null && datos.puntoId !== undefined;
    const tieneLibre =
      datos.puntoLibre !== null &&
      datos.puntoLibre !== undefined &&
      datos.puntoLibre.trim().length > 0;

    if (tienePunto && tieneLibre) {
      throw new ValidacionError(
        'Elija un punto del catálogo o escriba uno como adicional, pero no las dos cosas.',
        { puntoId: datos.puntoId, puntoLibre: datos.puntoLibre },
      );
    }

    if (tieneLibre && !datos.capturaLibrePermitida) {
      throw new ValidacionError(
        'Este formulario no admite puntos de encuentro adicionales: elija uno del catálogo.',
        { puntoLibre: datos.puntoLibre },
      );
    }

    if (!tienePunto && !tieneLibre) {
      throw new ValidacionError(
        'Indique el punto de encuentro del operativo.',
        {},
      );
    }

    return tienePunto
      ? UbicacionOperativa.enPuntoDelCatalogo(
          datos.zonalIds,
          datos.puntoId as number,
        )
      : UbicacionOperativa.enPuntoLibre(
          datos.zonalIds,
          datos.puntoLibre as string,
        );
  }

  get origenDelPunto(): OrigenPunto {
    return this.puntoId !== null ? 'CATALOGO' : 'CAPTURA_LIBRE';
  }

  /** RN-19. La jornada se reparte entre varias zonales. */
  get abarcaVariasZonales(): boolean {
    return this.zonalIds.length > 1;
  }

  incluyeZonal(zonalId: number): boolean {
    return this.zonalIds.includes(zonalId);
  }

  equivaleA(otra: UbicacionOperativa): boolean {
    return (
      this.puntoId === otra.puntoId &&
      this.puntoLibre === otra.puntoLibre &&
      this.zonalIds.length === otra.zonalIds.length &&
      this.zonalIds.every((zonal, indice) => zonal === otra.zonalIds[indice])
    );
  }
}

/** Sin repeticiones y en orden estable, para que la comparación por valor funcione. */
function normalizar(zonalIds: number[]): number[] {
  return [...new Set(zonalIds)].sort((uno, otro) => uno - otro);
}

function exigirZonales(zonalIds: number[]): void {
  if (zonalIds.length === 0) {
    throw new ValidacionError(
      'Seleccione al menos una zonal para el operativo.',
      {},
    );
  }

  const invalida = zonalIds.find(
    (zonal) => !Number.isInteger(zonal) || zonal <= 0,
  );

  if (invalida !== undefined) {
    throw new ValidacionError('Alguna de las zonales indicadas no es válida.', {
      zonalIds,
    });
  }
}
