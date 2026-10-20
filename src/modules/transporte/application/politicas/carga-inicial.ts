/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Administración · carga inicial
 * Archivo: carga-inicial.ts
 * Responsabilidad: Interpretar y validar las filas de la carga inicial de conductores, vehículos y garajes.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-07
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * FUNCIÓN PURA. La carga inicial es una opción OCULTA del administrador general (permiso
 * `carga-inicial:administrar`) para poblar el sistema la primera vez desde Excel. Aquí se lee la hoja
 * YA LEÍDA (matriz de celdas) y se valida cada fila; NO se escribe. La escritura (`aplicar`) vuelve a
 * pasar CADA fila por `validarDatos`, porque lo que llega del navegador no se cree: es el mismo
 * validador para la vista previa y para la aplicación.
 *
 * FORMATOS (fila de cabecera, sin importar tildes ni mayúsculas; el orden de columnas es libre):
 *   · conductores: CEDULA, NOMBRES, TELEFONO, SECTOR, CONTRATO, PARQUEADERO (SI/NO), ACTA,
 *                  ACTA_DESDE, ACTA_HASTA, PATRON
 *   · vehiculos:   PLACA, TIPO, ASIENTOS, KILOMETRAJE, MATRICULA_VENCE, SOAT_VENCE
 *   · garajes:     NOMBRE, ZONAL (vacía = garaje sin zonal, como la Matriz; es válido y no avisa)
 *   · turnos:      el HORARIO de la DAF (`importar-horario.ts`), no pasa por aquí.
 * Las fechas admiten fecha de Excel, AAAA-MM-DD o DD/MM/AAAA, y se guardan como AAAA-MM-DD.
 * La placa se escribe con `normalizarPlaca` (2026-10-15) y el nombre del garaje tal cual.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { normalizarPlaca } from './datos-flota';
import { normalizarTexto, type ValorCelda } from './importar-horario';

export type TipoCarga = 'conductores' | 'vehiculos' | 'garajes' | 'turnos';

export const TIPOS_CARGA: readonly TipoCarga[] = [
  'conductores',
  'vehiculos',
  'garajes',
  'turnos',
];

/** Columnas esperadas por tipo (la primera es obligatoria para reconocer la cabecera). */
export const FORMATO_ESPERADO: Record<TipoCarga, string[]> = {
  conductores: [
    'CEDULA',
    'NOMBRES',
    'TELEFONO',
    'SECTOR',
    'CONTRATO',
    'PARQUEADERO',
    'ACTA',
    'ACTA_DESDE',
    'ACTA_HASTA',
    'PATRON',
  ],
  vehiculos: [
    'PLACA',
    'TIPO',
    'ASIENTOS',
    'KILOMETRAJE',
    'MATRICULA_VENCE',
    'SOAT_VENCE',
  ],
  garajes: ['NOMBRE', 'ZONAL'],
  turnos: [
    'N°',
    'SECTOR DONDE VIVE',
    'NOMBRES',
    'CÉDULA (opcional)',
    'una columna por día del mes',
  ],
};

/** Los datos de una fila, en JSON plano (lo que viaja a la vista previa y vuelve en `aplicar`). */
export type DatosFila = Record<string, unknown>;

export interface FilaCarga {
  /** Número de fila en la hoja (1 = primera). */
  fila: number;
  valido: boolean;
  errores: string[];
  datos: DatosFila;
}

export interface PreviaCarga {
  tipo: TipoCarga;
  filas: FilaCarga[];
  resumen: { validas: number; invalidas: number };
  formatoEsperado: string[];
}

/** Lo que la validación necesita saber del sistema (para nombrar zonales). */
export interface ContextoCarga {
  zonales: readonly { id: number; nombre: string }[];
}

const SECTORES = ['NORTE', 'SUR', 'CENTRO', 'VALLE'];
const CONTRATOS = ['NOMBRAMIENTO', 'OCASIONAL'];
const PATRON_ROTACION = /^[DNELA]{2,14}$/;
const LARGO_PLACA = 10;

// ─────────────────────────── Lectura de celdas ───────────────────────────

function aTexto(valor: ValorCelda | undefined): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).trim();
}

/** Fecha de una celda: Date de Excel, AAAA-MM-DD o DD/MM/AAAA → AAAA-MM-DD; '' si vacía; null si no se entiende. */
export function fechaDeCelda(valor: ValorCelda | undefined): string | null {
  if (valor === null || valor === undefined || valor === '') return '';
  if (valor instanceof Date) {
    // exceljs entrega la fecha de calendario a medianoche UTC.
    return valor.toISOString().slice(0, 10);
  }
  const texto = String(valor).trim();
  let anio: number, mes: number, dia: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto);
  const latina = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(texto);
  if (iso) [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (latina)
    [dia, mes, anio] = [
      Number(latina[1]),
      Number(latina[2]),
      Number(latina[3]),
    ];
  else return null;
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia)
    return null;
  return fecha.toISOString().slice(0, 10);
}

/** La cabecera normalizada: «Matrícula vence» → «MATRICULA_VENCE». */
function claveDeCabecera(valor: ValorCelda | undefined): string {
  return normalizarTexto(aTexto(valor)).replace(/[\s-]+/g, '_');
}

// ─────────────────────────── Validación de datos (vista previa Y aplicación) ───────────────────────────

const texto = (v: unknown): string =>
  typeof v === 'string'
    ? v.trim()
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';

const fechaValida = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && fechaDeCelda(v) === v;

/**
 * Valida y normaliza los datos de una fila. Devuelve los datos limpios y los errores en palabras.
 * Se usa en la vista previa y otra vez en `aplicar`.
 */
export function validarDatos(
  tipo: Exclude<TipoCarga, 'turnos'>,
  crudos: Record<string, unknown>,
  contexto: ContextoCarga,
): { datos: DatosFila; errores: string[] } {
  const errores: string[] = [];
  if (tipo === 'conductores') {
    let cedula = texto(crudos.cedula).replace(/\s+/g, '');
    // Excel pierde el 0 inicial de una cédula escrita como número.
    if (/^\d{9}$/.test(cedula)) cedula = `0${cedula}`;
    if (!/^\d{10}$/.test(cedula))
      errores.push('La cédula debe tener diez dígitos.');
    const nombreCompleto = texto(crudos.nombreCompleto).toUpperCase();
    if (!nombreCompleto) errores.push('Falta el nombre del conductor.');
    if (nombreCompleto.length > 160)
      errores.push('El nombre no puede superar los 160 caracteres.');
    const telefono = texto(crudos.telefono);
    if (telefono && !/^\d{7,13}$/.test(telefono.replace(/[\s\-()+]/g, '')))
      errores.push('El teléfono no tiene un formato válido.');
    const sector = normalizarTexto(texto(crudos.sector));
    if (sector && !SECTORES.includes(sector))
      errores.push(`El sector admite ${SECTORES.join(', ')}.`);
    const contrato = normalizarTexto(texto(crudos.tipoContrato));
    if (contrato && !CONTRATOS.includes(contrato))
      errores.push('El contrato admite NOMBRAMIENTO u OCASIONAL.');
    const parqueaderoTexto = normalizarTexto(
      texto(crudos.parqueaderoAutorizado),
    );
    // null = la celda vino vacía: al actualizar no se toca lo que ya tiene el conductor.
    const parqueadero: boolean | null =
      typeof crudos.parqueaderoAutorizado === 'boolean'
        ? crudos.parqueaderoAutorizado
        : parqueaderoTexto
          ? ['SI', 'TRUE'].includes(parqueaderoTexto)
          : null;
    if (
      parqueaderoTexto &&
      !['SI', 'NO', 'TRUE', 'FALSE'].includes(parqueaderoTexto)
    )
      errores.push('PARQUEADERO admite SI o NO.');
    const acta = texto(crudos.actaParqueaderoNumero);
    const desde = texto(crudos.actaParqueaderoDesde);
    const hasta = texto(crudos.actaParqueaderoHasta);
    if ((desde && !fechaValida(desde)) || (hasta && !fechaValida(hasta)))
      errores.push(
        'La vigencia del acta se escribe como AAAA-MM-DD o DD/MM/AAAA.',
      );
    if (acta || desde || hasta) {
      if (parqueadero !== true)
        errores.push(
          'El acta solo se registra si el conductor tiene parqueadero autorizado (PARQUEADERO = SI).',
        );
      else if (!acta || !desde || !hasta)
        errores.push(
          'El acta necesita su número y su vigencia (desde y hasta).',
        );
      else if (desde > hasta)
        errores.push('La vigencia del acta termina antes de empezar.');
    }
    if (acta.length > 40)
      errores.push('El número de acta no supera los 40 caracteres.');
    const patron = texto(crudos.patronRotacion).toUpperCase();
    if (patron && !PATRON_ROTACION.test(patron))
      errores.push(
        'El patrón lleva de 2 a 14 letras: D (día), N (noche), E (ECU noche), L (libre) o A (administrativo).',
      );
    return {
      errores,
      datos: {
        cedula,
        nombreCompleto,
        telefono: telefono || null,
        sector: sector || null,
        tipoContrato: contrato || null,
        parqueaderoAutorizado: parqueadero,
        actaParqueaderoNumero: acta || null,
        actaParqueaderoDesde: desde || null,
        actaParqueaderoHasta: hasta || null,
        patronRotacion: patron || null,
      },
    };
  }

  if (tipo === 'vehiculos') {
    // La misma forma que el alta (A1): «pma 3370» y «PMA-3370» son la misma placa.
    const placa = normalizarPlaca(texto(crudos.placa));
    if (!placa) errores.push('Falta la placa.');
    if (placa.length > LARGO_PLACA)
      errores.push(`La placa no puede superar los ${LARGO_PLACA} caracteres.`);
    const tipoVehiculo = texto(crudos.tipo).toUpperCase();
    if (tipoVehiculo.length > 40)
      errores.push('El tipo no supera los 40 caracteres.');
    const entero = (
      v: unknown,
      nombre: string,
      min: number,
      max: number,
    ): number | null => {
      const t = texto(v);
      if (!t) return null;
      if (!/^\d+$/.test(t) || Number(t) < min || Number(t) > max) {
        errores.push(`${nombre} debe ser un entero entre ${min} y ${max}.`);
        return null;
      }
      return Number(t);
    };
    const asientos = entero(crudos.asientos, 'ASIENTOS', 1, 60);
    const kilometraje = entero(crudos.kilometraje, 'KILOMETRAJE', 0, 9_999_999);
    const matricula = texto(crudos.matriculaVencimiento);
    const soat = texto(crudos.soatVencimiento);
    if (matricula && !fechaValida(matricula))
      errores.push('MATRICULA_VENCE se escribe como AAAA-MM-DD o DD/MM/AAAA.');
    if (soat && !fechaValida(soat))
      errores.push('SOAT_VENCE se escribe como AAAA-MM-DD o DD/MM/AAAA.');
    return {
      errores,
      datos: {
        placa,
        tipo: tipoVehiculo || null,
        asientos,
        kilometraje,
        matriculaVencimiento: matricula || null,
        soatVencimiento: soat || null,
      },
    };
  }

  // garajes
  // Tal cual se escribió (A3); la unicidad compara sin tildes ni mayúsculas.
  const nombre = texto(crudos.nombre).replace(/\s+/g, ' ');
  if (!nombre) errores.push('Falta el nombre del garaje.');
  if (nombre.length > 120)
    errores.push('El nombre no supera los 120 caracteres.');
  const zonalTexto = texto(crudos.zonal);
  let zonalId: number | null = null;
  if (zonalTexto) {
    const buscada = normalizarTexto(zonalTexto);
    const zonal = contexto.zonales.find(
      (z) => normalizarTexto(z.nombre) === buscada,
    );
    if (zonal) zonalId = zonal.id;
    else errores.push(`La zonal «${zonalTexto}» no existe en el catálogo.`);
  }
  return {
    errores,
    datos: { nombre, zonal: zonalTexto || null, zonalId },
  };
}

// ─────────────────────────── Vista previa de una hoja ───────────────────────────

/** Cabecera de la hoja → propiedad de los datos. */
const COLUMNAS: Record<Exclude<TipoCarga, 'turnos'>, Record<string, string>> = {
  conductores: {
    CEDULA: 'cedula',
    NOMBRES: 'nombreCompleto',
    TELEFONO: 'telefono',
    SECTOR: 'sector',
    CONTRATO: 'tipoContrato',
    PARQUEADERO: 'parqueaderoAutorizado',
    ACTA: 'actaParqueaderoNumero',
    ACTA_DESDE: 'actaParqueaderoDesde',
    ACTA_HASTA: 'actaParqueaderoHasta',
    PATRON: 'patronRotacion',
  },
  vehiculos: {
    PLACA: 'placa',
    TIPO: 'tipo',
    ASIENTOS: 'asientos',
    KILOMETRAJE: 'kilometraje',
    MATRICULA_VENCE: 'matriculaVencimiento',
    SOAT_VENCE: 'soatVencimiento',
  },
  garajes: { NOMBRE: 'nombre', ZONAL: 'zonal' },
};

const COLUMNAS_FECHA = new Set([
  'actaParqueaderoDesde',
  'actaParqueaderoHasta',
  'matriculaVencimiento',
  'soatVencimiento',
]);

/** Interpreta la hoja de conductores, vehículos o garajes. No escribe. */
export function previsualizarCarga(
  tipo: Exclude<TipoCarga, 'turnos'>,
  hoja: readonly (readonly ValorCelda[])[],
  contexto: ContextoCarga,
): PreviaCarga {
  const columnas = COLUMNAS[tipo];
  const primera = FORMATO_ESPERADO[tipo][0];
  const indiceCabecera = hoja.findIndex((fila) =>
    fila.some((c) => claveDeCabecera(c) === primera),
  );
  if (indiceCabecera === -1) {
    return {
      tipo,
      filas: [
        {
          fila: 1,
          valido: false,
          errores: [
            `No se encontró la fila de cabecera: debe tener la columna ${primera}. Columnas esperadas: ${FORMATO_ESPERADO[tipo].join(', ')}.`,
          ],
          datos: {},
        },
      ],
      resumen: { validas: 0, invalidas: 1 },
      formatoEsperado: FORMATO_ESPERADO[tipo],
    };
  }

  const posicion = new Map<string, number>();
  hoja[indiceCabecera].forEach((c, i) => {
    const propiedad = columnas[claveDeCabecera(c)];
    if (propiedad && !posicion.has(propiedad)) posicion.set(propiedad, i);
  });

  const filas: FilaCarga[] = [];
  for (let i = indiceCabecera + 1; i < hoja.length; i += 1) {
    const celdas = hoja[i] ?? [];
    if (!celdas.some((c) => aTexto(c) !== '')) continue;
    const crudos: Record<string, unknown> = {};
    const erroresLectura: string[] = [];
    for (const [propiedad, columna] of posicion) {
      const valor = celdas[columna];
      if (COLUMNAS_FECHA.has(propiedad)) {
        const fecha = fechaDeCelda(valor);
        if (fecha === null) {
          erroresLectura.push(
            `«${aTexto(valor)}» no es una fecha válida (AAAA-MM-DD o DD/MM/AAAA).`,
          );
          crudos[propiedad] = '';
        } else crudos[propiedad] = fecha;
      } else {
        crudos[propiedad] = aTexto(valor);
      }
    }
    const { datos, errores } = validarDatos(tipo, crudos, contexto);
    const todos = [...erroresLectura, ...errores];
    filas.push({
      fila: i + 1,
      valido: todos.length === 0,
      errores: todos,
      datos,
    });
  }

  // Duplicados dentro del mismo archivo: la segunda aparición no se aplica.
  const clave = {
    conductores: 'cedula',
    vehiculos: 'placa',
    garajes: 'nombre',
  }[tipo];
  const vistas = new Map<string, number>();
  for (const f of filas) {
    const valor = normalizarTexto(texto(f.datos[clave]));
    if (!valor) continue;
    const previa = vistas.get(valor);
    if (previa !== undefined) {
      f.errores.push(
        `Repetido en el archivo: ya aparece en la fila ${previa}.`,
      );
      f.valido = false;
    } else vistas.set(valor, f.fila);
  }

  const validas = filas.filter((f) => f.valido).length;
  return {
    tipo,
    filas,
    resumen: { validas, invalidas: filas.length - validas },
    formatoEsperado: FORMATO_ESPERADO[tipo],
  };
}
