/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: logger.service.ts
 * Responsabilidad: Emitir registros estructurados sin datos personales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * LO QUE NUNCA SE REGISTRA, de docs/FASE4-arquitectura-tecnica.md §12.4:
 * teléfonos, cédulas, contenido de órdenes de servicio, tokens y credenciales.
 *
 * No basta con la disciplina de quien escribe la llamada: el servicio SUPRIME esos
 * campos aunque se le pasen. Es el mismo criterio que aplica el análisis al dato
 * aislado de la orden de servicio (HAL-04): convertir una regla de conducta en una
 * garantía de la construcción.
 */

import { Injectable, LoggerService as LoggerNest } from '@nestjs/common';

import { obtenerContexto } from '../contexto/contexto-peticion';
import { marcaDeTiempo } from '../utilidades/marca-tiempo';
import { sinAcentos } from '../utilidades/texto';

export type NivelRegistro = 'error' | 'warn' | 'info' | 'debug';

/**
 * Raíces de nombre cuyo valor nunca sale en un registro.
 *
 * SE COMPARAN COMO SUBCADENA sobre el nombre normalizado —minúsculas, sin acentos y
 * sin separadores—, no por igualdad exacta. La lista anterior era exacta y sensible a
 * mayúsculas, de modo que `telefono` se suprimía pero `telefonoContacto`,
 * `Telefono` y `cedulaFuncionario` salían íntegros. Con M-09 esos nombres compuestos
 * son la norma, no la excepción.
 *
 * `clave` NO figura, y es deliberado: en castellano designa tanto una contraseña como
 * la clave de un parámetro, y suprimirla borraba de la traza QUÉ parámetro de política
 * se había modificado. Las contraseñas se cubren con `password`, `contrasena` y
 * `claveacceso`.
 */
const RAICES_SUPRIMIDAS = [
  'telefono',
  'cedula',
  'datoaislado',
  'token',
  'authorization',
  'password',
  'contrasena',
  'claveacceso',
  'secreto',
  'apikey',
];

const SUPRIMIDO = '[suprimido]';
const CIRCULAR = '[referencia circular]';
const PROFUNDO = '[profundidad excedida]';

/** Más allá de este anidamiento el registro deja de ser legible y se corta. */
const PROFUNDIDAD_MAXIMA = 6;

/** Nombre comparable: sin acentos, sin separadores y en minúsculas. */
function normalizarNombre(nombre: string): string {
  return sinAcentos(nombre)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function debeSuprimirse(nombre: string): boolean {
  const normalizado = normalizarNombre(nombre);
  return RAICES_SUPRIMIDAS.some((raiz) => normalizado.includes(raiz));
}

const ORDEN_NIVEL: Record<NivelRegistro, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/** Datos adicionales que acompañan a un registro. */
export type DatosRegistro = Record<string, unknown>;

@Injectable()
export class LoggerService implements LoggerNest {
  private readonly nivelMinimo: NivelRegistro;

  constructor() {
    const configurado = (process.env.LOG_LEVEL ?? 'info') as NivelRegistro;
    this.nivelMinimo = configurado in ORDEN_NIVEL ? configurado : 'info';
  }

  error(mensaje: string, datos?: DatosRegistro | string): void {
    this.emitir('error', mensaje, datos);
  }

  warn(mensaje: string, datos?: DatosRegistro | string): void {
    this.emitir('warn', mensaje, datos);
  }

  /** Hitos del negocio: cuadro cerrado, orden emitida. */
  log(mensaje: string, datos?: DatosRegistro | string): void {
    this.emitir('info', mensaje, datos);
  }

  debug(mensaje: string, datos?: DatosRegistro | string): void {
    this.emitir('debug', mensaje, datos);
  }

  private emitir(
    nivel: NivelRegistro,
    mensaje: string,
    datos?: DatosRegistro | string,
  ): void {
    if (ORDEN_NIVEL[nivel] > ORDEN_NIVEL[this.nivelMinimo]) {
      return;
    }

    const contexto = obtenerContexto();
    // Nest invoca a su registrador con una cadena de contexto como segundo argumento
    // -«NestApplication», «RoutesResolver»-; el módulo lo hace con un objeto de datos.
    // Se admiten ambas formas para que toda la aplicación emita el mismo formato.
    const adicionales: DatosRegistro =
      typeof datos === 'string' ? { origen: datos } : (datos ?? {});

    const registro = {
      momento: marcaDeTiempo(),
      nivel,
      modulo: 'transporte',
      correlacionId: contexto?.correlacionId,
      usuarioId: contexto?.usuarioId,
      rol: contexto?.rol,
      mensaje,
      ...suprimirDatosPersonales(adicionales),
    };

    const salida = serializar(registro, mensaje, nivel);

    if (nivel === 'error') {
      console.error(salida);
    } else if (nivel === 'warn') {
      console.warn(salida);
    } else {
      console.log(salida);
    }
  }
}

/**
 * Serializa el registro sin poder fallar.
 *
 * `JSON.stringify` lanza ante un BigInt o una estructura que la supresión no haya
 * podido normalizar. Que el registrador tumbe la petición que estaba registrando es
 * el peor final posible, así que ante el fallo se emite una línea mínima que conserva
 * el mensaje y avisa de lo ocurrido.
 */
function serializar(
  registro: Record<string, unknown>,
  mensaje: string,
  nivel: NivelRegistro,
): string {
  try {
    return JSON.stringify(registro);
  } catch {
    return JSON.stringify({
      momento: marcaDeTiempo(),
      nivel,
      modulo: 'transporte',
      mensaje,
      advertencia: 'Los datos adicionales no se pudieron serializar.',
    });
  }
}

/**
 * Reemplaza el valor de los campos sensibles, recorriendo objetos y arreglos.
 * Se exporta para poder probarlo por separado.
 *
 * Protegido contra referencias circulares y anidamientos desmedidos: el registrador
 * lo invoca también el filtro de excepciones, y un desbordamiento de pila AHÍ dejaría
 * la petición sin respuesta y sin traza. Un objeto de Express pasado por descuido a
 * `logger.error` basta para provocarlo.
 */
export function suprimirDatosPersonales(valor: DatosRegistro): DatosRegistro;
export function suprimirDatosPersonales(valor: unknown): unknown;
export function suprimirDatosPersonales(valor: unknown): unknown {
  return recorrer(valor, new WeakSet<object>(), 0);
}

function recorrer(
  valor: unknown,
  vistos: WeakSet<object>,
  profundidad: number,
): unknown {
  if (valor === null || typeof valor !== 'object') {
    return valor;
  }

  if (vistos.has(valor)) return CIRCULAR;
  if (profundidad >= PROFUNDIDAD_MAXIMA) return PROFUNDO;

  vistos.add(valor);

  if (Array.isArray(valor)) {
    return valor.map((elemento) => recorrer(elemento, vistos, profundidad + 1));
  }

  if (valor instanceof Date) return valor.toISOString();

  const resultado: Record<string, unknown> = {};
  for (const [nombre, contenido] of Object.entries(
    valor as Record<string, unknown>,
  )) {
    resultado[nombre] = debeSuprimirse(nombre)
      ? SUPRIMIDO
      : recorrer(contenido, vistos, profundidad + 1);
  }
  return resultado;
}
