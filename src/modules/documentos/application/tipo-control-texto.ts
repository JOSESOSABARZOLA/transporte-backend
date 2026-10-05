/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Documentos
 * Archivo: tipo-control-texto.ts
 * Responsabilidad: Un solo texto para el tipo de control de un operativo en la matriz, la
 *   jornada y la exportación, sea uno o varios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-07
 *
 * DESDE EL 2026-09-07 EL TIPO PUEDE SER VARIOS (form 8). El join `t_operativo_tipo_control`
 * guarda los del catálogo; se muestran unidos por coma, y el adicional (`tipoLibre`) se suma
 * al final. En los demás formularios sigue siendo uno solo en `tipoControl`, o el adicional.
 */

/** Compone el texto del tipo de control. `vacio` es lo que se muestra si no hay ninguno. */
export function textoDeTipoControl(
  operativo: {
    tipoControl: { nombre: string } | null;
    tiposControl?: { tipo: { nombre: string } }[];
    tipoLibre: string | null;
  },
  vacio = '',
): string {
  const nombres = (operativo.tiposControl ?? []).map(
    (fila) => fila.tipo.nombre,
  );
  if (operativo.tipoLibre) {
    nombres.push(operativo.tipoLibre);
  }
  if (nombres.length > 0) {
    return nombres.join(', ');
  }
  return operativo.tipoControl?.nombre ?? vacio;
}
