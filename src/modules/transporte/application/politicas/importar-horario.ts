/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Transporte DAF · turnos de conductores
 * Archivo: importar-horario.ts
 * Responsabilidad: Interpretar la hoja HORARIO de la DAF y proponer las celdas del mes, sin escribir.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-06
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUNCIÓN PURA. Recibe la hoja YA LEÍDA (una matriz de celdas: texto, número o fecha), el mes, los
 * conductores activos y sus ausencias, y devuelve qué se escribiría. No toca la base: la escritura
 * es el `PUT …/lote` de siempre, que vuelve a validar cada celda.
 *
 * FORMATO ADMITIDO (el HORARIO de la DAF):
 *   · Una fila de CABECERA que contiene «NOMBRES» (sin importar tildes ni mayúsculas). Columnas
 *     reconocidas: «N°», «SECTOR DONDE VIVE», «NOMBRES» y, si existe, «CÉDULA».
 *   · Una columna por FECHA. La cabecera puede ser: una fecha de Excel; el número del día del mes
 *     (1–31); un texto que termine en el número del día («LUNES 01», «01»); o una fecha escrita
 *     «AAAA-MM-DD» / «DD/MM/AAAA» del mes que se importa. Las fechas de otro mes se ignoran.
 *   · Valores: OPERATIVO DIA → DIA · OPERATIVO NOCHE → NOCHE · ECU NOCHE → ECU_NOCHE · LIBRE → LIBRE
 *     · ACTIVIDADES ADMINISTRATIVAS → ADMINISTRATIVO. VACACIONES NO se escribe (es una ausencia: se
 *     gestiona en Flota y garajes › Conductores › Ausencias). Celda vacía = sin turno.
 *
 * EMPAREJAMIENTO: por CÉDULA si la fila la trae (columna «CÉDULA» o un número de 10 dígitos en la
 * fila); si no, por NOMBRE normalizado exacto contra el conductor activo. Ninguno o varios
 * candidatos = error de fila (la fila entera no se importa). Un valor no reconocido es un error de
 * ESA celda: el resto de la fila sí se importa.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

/** Los turnos que se escriben en la matriz (espejo del enumerado `TurnoConductor`). */
export type TurnoImportado =
  | 'DIA'
  | 'NOCHE'
  | 'ECU_NOCHE'
  | 'LIBRE'
  | 'ADMINISTRATIVO';

/** Una celda tal como la entrega la lectura del archivo. */
export type ValorCelda = string | number | Date | null;

export interface ConductorImportable {
  id: number;
  cedula: string;
  nombreCompleto: string;
}

export interface AusenciaImportable {
  conductorId: number;
  /** AAAA-MM-DD, inclusive. */
  desde: string;
  hasta: string;
}

export interface FilaPrevia {
  /** Número de fila en la hoja (1 = primera). */
  fila: number;
  nombre: string;
  conductorId: number | null;
  conductor: string | null;
  /** Celdas válidas que aporta esta fila. */
  celdas: number;
  errores: string[];
}

export interface CeldaPrevia {
  conductorId: number;
  fecha: string;
  turno: TurnoImportado;
}

export interface PreviaImportacion {
  mes: string;
  filas: FilaPrevia[];
  celdas: CeldaPrevia[];
  omitidas: { fila: number; fecha: string; motivo: string }[];
}

const VALORES: Record<string, TurnoImportado | 'VACACIONES'> = {
  'OPERATIVO DIA': 'DIA',
  'OPERATIVO NOCHE': 'NOCHE',
  'ECU NOCHE': 'ECU_NOCHE',
  LIBRE: 'LIBRE',
  'ACTIVIDADES ADMINISTRATIVAS': 'ADMINISTRATIVO',
  VACACIONES: 'VACACIONES',
};

/** Mayúsculas, sin tildes y con los espacios colapsados. */
export function normalizarTexto(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function comoTexto(valor: ValorCelda): string {
  if (valor === null) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).trim();
}

/**
 * La fecha (AAAA-MM-DD) que representa una cabecera de columna, si es un día del mes importado.
 * `null` si la cabecera no es una fecha de ese mes.
 */
export function fechaDeCabecera(
  valor: ValorCelda,
  anio: number,
  mes: number,
  diasDelMes: number,
): string | null {
  const delMes = (dia: number): string | null =>
    Number.isInteger(dia) && dia >= 1 && dia <= diasDelMes
      ? `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
      : null;

  if (valor instanceof Date) {
    if (valor.getUTCFullYear() !== anio || valor.getUTCMonth() + 1 !== mes) {
      return null;
    }
    return delMes(valor.getUTCDate());
  }
  if (typeof valor === 'number') return delMes(valor);
  const texto = comoTexto(valor);
  if (texto === '') return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (iso) {
    return Number(iso[1]) === anio && Number(iso[2]) === mes
      ? delMes(Number(iso[3]))
      : null;
  }
  const latina = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (latina) {
    return Number(latina[3]) === anio && Number(latina[2]) === mes
      ? delMes(Number(latina[1]))
      : null;
  }
  // «LUNES 01», «01», «1»: el número final es el día.
  const final = /(\d{1,2})$/.exec(texto);
  return final ? delMes(Number(final[1])) : null;
}

/** Interpreta la hoja HORARIO y propone las celdas del mes. No escribe nada. */
export function previsualizarHorario(entrada: {
  mes: string;
  hoja: ValorCelda[][];
  conductores: ConductorImportable[];
  ausencias: AusenciaImportable[];
}): PreviaImportacion {
  const { mes, hoja, conductores, ausencias } = entrada;
  const [anio, mesNum] = mes.split('-').map(Number);
  const diasDelMes = new Date(Date.UTC(anio, mesNum, 0)).getUTCDate();

  const resultado: PreviaImportacion = {
    mes,
    filas: [],
    celdas: [],
    omitidas: [],
  };

  const indiceCabecera = hoja.findIndex((fila) =>
    fila.some((celda) => normalizarTexto(comoTexto(celda)) === 'NOMBRES'),
  );
  if (indiceCabecera === -1) {
    resultado.filas.push({
      fila: 1,
      nombre: '',
      conductorId: null,
      conductor: null,
      celdas: 0,
      errores: [
        'No se encontró la fila de cabecera con la columna «NOMBRES». Revise que el archivo tenga el formato HORARIO de la DAF.',
      ],
    });
    return resultado;
  }

  const cabecera = hoja[indiceCabecera];
  const columnaDe = (nombre: string): number =>
    cabecera.findIndex((celda) => normalizarTexto(comoTexto(celda)) === nombre);
  const colNombres = columnaDe('NOMBRES');
  const colCedula = cabecera.findIndex((celda) =>
    normalizarTexto(comoTexto(celda)).startsWith('CEDULA'),
  );
  const columnasFecha = cabecera
    .map((celda, indice) => ({
      indice,
      fecha:
        indice === colNombres || indice === colCedula
          ? null
          : fechaDeCabecera(celda, anio, mesNum, diasDelMes),
    }))
    .filter((c): c is { indice: number; fecha: string } => c.fecha !== null);

  const porCedula = new Map(conductores.map((c) => [c.cedula.trim(), c]));
  const porNombre = new Map<string, ConductorImportable[]>();
  for (const c of conductores) {
    const clave = normalizarTexto(c.nombreCompleto);
    porNombre.set(clave, [...(porNombre.get(clave) ?? []), c]);
  }
  const ausenteEl = (conductorId: number, fecha: string): boolean =>
    ausencias.some(
      (a) =>
        a.conductorId === conductorId && a.desde <= fecha && fecha <= a.hasta,
    );

  for (let i = indiceCabecera + 1; i < hoja.length; i += 1) {
    const fila = hoja[i];
    const nombre = comoTexto(fila[colNombres] ?? null);
    const numeroFila = i + 1;
    if (nombre === '') continue; // filas vacías o de totales sin nombre

    const errores: string[] = [];

    // Cédula: la columna, o cualquier número de 10 dígitos de la fila.
    const cedula =
      (colCedula >= 0 ? comoTexto(fila[colCedula] ?? null) : '') ||
      fila.map(comoTexto).find((texto) => /^\d{10}$/.test(texto)) ||
      '';
    let conductor: ConductorImportable | null = null;
    if (cedula && porCedula.has(cedula)) {
      conductor = porCedula.get(cedula) ?? null;
    } else {
      const candidatos = porNombre.get(normalizarTexto(nombre)) ?? [];
      if (candidatos.length === 1) conductor = candidatos[0];
      else if (candidatos.length > 1) {
        errores.push(
          `Hay ${candidatos.length} conductores activos con el nombre «${nombre}»: agregue la cédula para distinguirlos.`,
        );
      } else {
        errores.push(
          `No hay un conductor activo llamado «${nombre}»${cedula ? ` ni con la cédula ${cedula}` : ''}. Revise el nombre o regístrelo en Flota.`,
        );
      }
    }

    let validas = 0;
    if (conductor) {
      for (const { indice, fecha } of columnasFecha) {
        const texto = normalizarTexto(comoTexto(fila[indice] ?? null));
        if (texto === '') continue;
        const valor = VALORES[texto];
        if (!valor) {
          const motivo = `Día ${fecha.slice(8)}: valor «${comoTexto(fila[indice] ?? null)}» no reconocido.`;
          errores.push(motivo);
          resultado.omitidas.push({ fila: numeroFila, fecha, motivo });
          continue;
        }
        if (valor === 'VACACIONES') {
          if (!ausenteEl(conductor.id, fecha)) {
            const motivo = `Día ${fecha.slice(8)}: VACACIONES no se importa; regístrelas en Flota y garajes › Conductores › Ausencias.`;
            errores.push(motivo);
            resultado.omitidas.push({ fila: numeroFila, fecha, motivo });
          }
          continue;
        }
        if (ausenteEl(conductor.id, fecha)) {
          resultado.omitidas.push({
            fila: numeroFila,
            fecha,
            motivo: 'Ese día el conductor tiene una ausencia registrada.',
          });
          continue;
        }
        resultado.celdas.push({
          conductorId: conductor.id,
          fecha,
          turno: valor,
        });
        validas += 1;
      }
    }

    resultado.filas.push({
      fila: numeroFila,
      nombre,
      conductorId: conductor?.id ?? null,
      conductor: conductor?.nombreCompleto ?? null,
      celdas: validas,
      errores,
    });
  }

  return resultado;
}
