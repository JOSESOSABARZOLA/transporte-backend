/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Documentos
 * Archivo: motor-documento.ts
 * Responsabilidad: Envolver pdfmake (fuentes Roboto + acceso a activos locales) y generar el buffer.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-15
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PDFMAKE, Y NO PDFKIT, SOLO PARA EL MEMORANDO. Y CONVIENE DECIR POR QUÉ CONVIVEN.
 *
 * La matriz consolidada y la orden de servicio corta se dibujan con **pdfkit** (dibujo
 * imperativo x/y), que trae sus fuentes incrustadas y no depende de archivos en disco. Ese
 * fue el motivo de elegirlo (ver `exportador-matriz.ts`).
 *
 * La Orden de Servicio en formato **memorando** es otro animal: dos páginas, apartados,
 * tablas con borde y texto legal fijo. Eso es justo lo que pdfmake —declarativo— resuelve
 * con naturalidad, y es el mismo motor con el que el módulo de Instrucción arma sus
 * documentos oficiales. Se reutiliza su patrón en vez de reinventarlo en pdfkit.
 *
 * EL PRECIO DE PDFMAKE SON LAS FUENTES EN DISCO. Necesita los `.ttf` de Roboto y hay que
 * registrarlos. Ya están en `fonts/` del repositorio, y el `Dockerfile` los copia a la
 * imagen (línea `COPY fonts ./fonts`). Si faltaran, este módulo lanza al primer uso con un
 * mensaje claro, no un PDF corrupto.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import pdfmake from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/** Roboto vive en `<cwd>/fonts`; el logotipo en `<cwd>/src/assets`. Igual en dev y en la imagen. */
const CARPETA_FUENTES = path.resolve(process.cwd(), 'fonts');
const CARPETA_ACTIVOS = path.resolve(process.cwd(), 'src', 'assets');

const FUENTES = {
  Roboto: {
    normal: path.join(CARPETA_FUENTES, 'Roboto-Regular.ttf'),
    bold: path.join(CARPETA_FUENTES, 'Roboto-Bold.ttf'),
    italics: path.join(CARPETA_FUENTES, 'Roboto-Italic.ttf'),
    bolditalics: path.join(CARPETA_FUENTES, 'Roboto-BoldItalic.ttf'),
  },
} as const;

let preparado = false;

/**
 * Registra las fuentes y la política de acceso una sola vez.
 *
 * `setLocalAccessPolicy` acota a pdfmake a leer SOLO de `fonts/` y `src/assets/`: no puede
 * abrir ningún otro archivo del contenedor aunque una definición lo pidiera.
 */
function preparar(): void {
  if (preparado) return;

  for (const [variante, ruta] of Object.entries(FUENTES.Roboto)) {
    if (!existsSync(ruta)) {
      throw new Error(
        `Fuente Roboto ausente (${variante}): ${ruta}. Copie los .ttf a la carpeta fonts/.`,
      );
    }
  }

  pdfmake.addFonts(FUENTES);

  (
    pdfmake as unknown as {
      setLocalAccessPolicy: (fn: (ruta: string) => boolean) => void;
    }
  ).setLocalAccessPolicy(
    (ruta: string) =>
      ruta.startsWith(CARPETA_FUENTES) || ruta.startsWith(CARPETA_ACTIVOS),
  );

  preparado = true;
}

/** Compone la definición pdfmake y devuelve el PDF completo. */
export async function generarDocumento(
  definicion: TDocumentDefinitions,
): Promise<Buffer> {
  preparar();
  return pdfmake.createPdf(definicion).getBuffer();
}

/** La ruta del logotipo institucional, para que las plantillas lo referencien. */
export const RUTA_LOGOTIPO = path.join(CARPETA_ACTIVOS, 'logo-amc.png');
export const HAY_LOGOTIPO = (): boolean => existsSync(RUTA_LOGOTIPO);
