/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Documentos
 * Archivo: identidad-institucional.ts
 * Responsabilidad: El membrete y la paleta de los documentos que salen del sistema.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-25
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * UN SOLO SITIO PARA EL MEMBRETE, PORQUE SON DOS DOCUMENTOS Y UNA INSTITUCIÓN.
 *
 * La matriz consolidada y la orden de servicio salen del mismo organismo y tienen que
 * verse del mismo organismo. Repetir el bloque en los dos exportadores garantiza que un
 * día se corrija uno y no el otro.
 *
 * CIERRA PV-30. Hasta el 2026-08-25 el logotipo del backend era `src/assets/LogoAmc.jpeg`:
 * **setenta bytes, un PNG transparente de 1×1 con extensión `.jpeg`**. Peor que la
 * ausencia, porque tenía el nombre y la ruta correctos y usarlo sin mirarlo habría
 * impreso un píxel invisible en el membrete de un documento oficial. Por eso la matriz
 * imprimía la identificación **en texto**. Ya no: el archivo real está en su sitio.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * SI EL ARCHIVO NO ESTÁ, EL DOCUMENTO SIGUE SALIENDO. Se vuelve al membrete de texto y se
 * registra el aviso. Un despliegue mal armado no puede dejar a la Dirección sin poder
 * emitir órdenes: el documento vale por lo que dice, no por su logotipo.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { Logger } from '@nestjs/common';

const logger = new Logger('IdentidadInstitucional');

/**
 * Paleta institucional, del manual *Nueva Imagen 2025*.
 *
 * Son los mismos valores que el tema de la aplicación, y **es el único sitio del backend
 * donde se escriben**: si mañana cambian, cambian aquí y en `src/index.css` del frontend.
 */
export const TINTA = {
  /** Azul marino. El manual lo asigna a «fondos principales, encabezados». */
  institucional: '#20347d',
  /** Azul medio. Filetes y apoyos. */
  medio: '#1b77bb',
  /** Texto principal de los documentos. */
  cuerpo: '#1a1f36',
  /** Texto secundario: rótulos, notas al pie. */
  apoyo: '#5a6d99',
  /** Fondo de las cajas de aviso. Tenue, nunca a sangre (regla del manual). */
  reposo: '#eef2f8',
  /*
    NEUTROS DE TRAMOYA DEL DOCUMENTO. 2026-09-15.

    No son colores de MARCA —no se reflejan en `src/index.css`—: son los grises de
    filetes, cebra y rejilla de las tablas del PDF. Antes vivían sueltos en cada
    exportador (`#dddddd`, `#eeeeee`, `#e9e9e9`, `#d2d9e7`), y un día se corregía uno
    y no el otro. Se centralizan aquí, junto a la paleta, por el mismo motivo que el
    resto: un solo sitio.
  */
  /** Hairline de filetes y separadores de celda. */
  filete: '#d2d9e7',
  /** Fondo de las filas alternas (cebra). Muy tenue, derivado del reposo. */
  cebra: '#f5f7fb',
  /**
   * Fondo AMARILLO de un dato del memorando SIN COMPLETAR (D13, 2026-10-01). Resalta los `[campos]`
   * que faltan en lugar del antiguo `XXXX`, para que se vean de un vistazo antes de emitir en firme.
   */
  faltante: '#ffe9a8',
} as const;

/**
 * El logotipo institucional, si está.
 *
 * El `Dockerfile` copia `src/assets` a la imagen —línea 66— y el proceso corre con
 * `cwd` en la raíz del proyecto, así que esta ruta vale igual en desarrollo y en el
 * contenedor. `nest-cli.json` **no** copia activos a `dist`, y por eso no se busca allí.
 */
const RUTA_LOGO = path.resolve(process.cwd(), 'src', 'assets', 'logo-amc.png');

/** Proporción del archivo entregado por la DNP: 1200 × 268. */
const PROPORCION_LOGO = 1200 / 268;

let avisado = false;

export function hayLogotipo(): boolean {
  const hay = existsSync(RUTA_LOGO);

  if (!hay && !avisado) {
    avisado = true;
    logger.warn(
      `No se encontró el logotipo institucional en ${RUTA_LOGO}. Los documentos se emiten con el membrete en texto.`,
    );
  }

  return hay;
}

interface Membrete {
  /** Ancho del logotipo en puntos. El alto se deriva de su proporción. */
  ancho: number;
  x: number;
  y: number;
  /** Qué decir si el archivo no está. Se imprime en su lugar. */
  respaldo: string;
}

/**
 * Imprime el membrete y devuelve la **coordenada Y donde termina**.
 *
 * Devolver el final y no un alto fijo es lo que permite que el respaldo de texto y el
 * logotipo convivan sin descuadrar lo que viene debajo.
 */
export function imprimirMembrete(
  documento: PDFKit.PDFDocument,
  { ancho, x, y, respaldo }: Membrete,
): number {
  if (hayLogotipo()) {
    const alto = ancho / PROPORCION_LOGO;
    documento.image(RUTA_LOGO, x, y, { width: ancho });
    return y + alto;
  }

  documento
    .font('Helvetica-Bold')
    .fontSize(13)
    .fillColor(TINTA.institucional)
    .text(respaldo, x, y);

  return documento.y;
}

/** Filete institucional de ancho completo. Recto, sin degradado: manual de marca. */
export function imprimirFilete(
  documento: PDFKit.PDFDocument,
  x: number,
  y: number,
  ancho: number,
  grosor = 1.2,
): void {
  documento
    .moveTo(x, y)
    .lineTo(x + ancho, y)
    .strokeColor(TINTA.institucional)
    .lineWidth(grosor)
    .stroke();
}
