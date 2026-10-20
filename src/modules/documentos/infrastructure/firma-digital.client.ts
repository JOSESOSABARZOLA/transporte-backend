/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio · firma digital
 * Archivo: firma-digital.client.ts
 * Responsabilidad: Firmar el memorando con el servicio externo de firma (.p12), si está configurado.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-22
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * PLUMBING CONFIGURABLE POR ENTORNO, SIN SECRETOS EN EL REPOSITORIO.
 *
 * Replica el contrato del servicio de firma de la AMC (el mismo que usa el módulo de
 * resolución): un POST multipart con el PDF, el certificado `.p12`, su clave y la página
 * donde va la firma; devuelve el PDF firmado.
 *
 * TRES ESTADOS, y son deliberados:
 *
 *   1. NO CONFIGURADO (faltan FIRMA_URL / FIRMA_P12_PATH / FIRMA_P12_CLAVE): se entrega el
 *      memorando SIN firmar y se registra un aviso. Es el modo de desarrollo, e inerte a
 *      propósito: nada se firma hasta que operaciones ponga las variables.
 *   2. CONFIGURADO y OK: devuelve el PDF firmado.
 *   3. CONFIGURADO y FALLA (servicio caído o rechaza): LANZA un error 502 con mensaje para
 *      el funcionario. No se entrega un PDF sin firmar haciéndolo pasar por firmado —eso
 *      sería peor que el fallo— ni se oculta: quien emite se entera y reintenta.
 *
 * SIN AXIOS NI `form-data`: con el `fetch`/`FormData`/`Blob` globales de Node 20, igual que
 * `auth-usuarios.client.ts`. No se agrega ninguna dependencia.
 *
 * LOS SECRETOS (URL, ruta del `.p12`, su clave y un token opcional) VIVEN EN EL ENTORNO,
 * nunca aquí. Ver `.env.preproduccion.example` y `DESPLIEGUE.md`.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { Injectable } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';

import { ApplicationError } from '../../../common/errors/application.error';
import { CODIGOS_ERROR } from '../../../common/errors/codigos-error';
import { LoggerService } from '../../../common/logger/logger.service';

/** Lo que hace falta para firmar. `null` = firma no configurada (modo inerte). */
interface ConfigFirma {
  /** URL completa del endpoint de firma (p. ej. `http://host:puerto/api/firmas/sign-pdf/upload`). */
  url: string;
  /** Ruta del certificado `.p12` montado en el contenedor. */
  p12Path: string;
  /** Clave del certificado `.p12`. */
  clave: string;
  /** Token Bearer del servicio de firma, si lo exige. */
  token?: string;
  /** Página donde va la firma. Sin ella, la ÚLTIMA (donde está el bloque de firma del memorando). */
  pagina?: number;
}

/** Lee la configuración del entorno. Devuelve `null` si falta cualquiera de las tres claves. */
function leerConfig(): ConfigFirma | null {
  const url = process.env.FIRMA_URL?.trim();
  const p12Path = process.env.FIRMA_P12_PATH?.trim();
  const clave = process.env.FIRMA_P12_CLAVE;

  if (!url || !p12Path || !clave) return null;

  const paginaCruda = process.env.FIRMA_PAGINA?.trim();
  const pagina = paginaCruda ? Number(paginaCruda) : undefined;

  return {
    url,
    p12Path,
    clave,
    token: process.env.FIRMA_TOKEN?.trim() || undefined,
    pagina:
      pagina !== undefined && Number.isInteger(pagina) ? pagina : undefined,
  };
}

@Injectable()
export class FirmaDigitalClient {
  constructor(private readonly logger: LoggerService) {}

  /** ¿Está configurada la firma? Para el aviso de arranque y las pruebas. */
  get habilitada(): boolean {
    return leerConfig() !== null;
  }

  /**
   * Firma el PDF con el servicio externo. Sin configurar, lo devuelve tal cual (avisa). Con la
   * firma configurada y un fallo del servicio, lanza un 502 con mensaje para el funcionario.
   */
  async firmar(pdf: Buffer): Promise<Buffer> {
    const config = leerConfig();

    if (!config) {
      this.logger.warn(
        'Firma digital no configurada: el memorando se entrega SIN firmar. Defina FIRMA_URL, FIRMA_P12_PATH y FIRMA_P12_CLAVE para activarla.',
      );
      return pdf;
    }

    const certificado = await this.leerCertificado(config.p12Path);
    const pagina = config.pagina ?? (await this.ultimaPagina(pdf));

    const formulario = new FormData();
    formulario.append(
      'pdf',
      new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }),
      'document.pdf',
    );
    formulario.append(
      'signature',
      new Blob([new Uint8Array(certificado)], {
        type: 'application/x-pkcs12',
      }),
      basename(config.p12Path),
    );
    formulario.append('password', config.clave);
    formulario.append('page', String(pagina));

    // El Content-Type multipart (con su boundary) lo pone `fetch` solo al recibir un FormData.
    const cabeceras: Record<string, string> = {};
    if (config.token) cabeceras.Authorization = `Bearer ${config.token}`;

    let respuesta: Response;
    try {
      respuesta = await fetch(config.url, {
        method: 'POST',
        body: formulario,
        headers: cabeceras,
      });
    } catch (causa) {
      this.logger.error('El servicio de firma no respondió.', {
        error: causa instanceof Error ? causa.message : String(causa),
      });
      throw new ApplicationError(
        'No se pudo firmar el memorando: el servicio de firma no respondió. Inténtelo de nuevo en unos minutos.',
        502,
        CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
      );
    }

    if (!respuesta.ok) {
      this.logger.error('El servicio de firma rechazó la petición.', {
        estado: respuesta.status,
      });
      throw new ApplicationError(
        `No se pudo firmar el memorando: el servicio de firma respondió ${respuesta.status}.`,
        502,
        CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
      );
    }

    return Buffer.from(await respuesta.arrayBuffer());
  }

  /** Lee el certificado del disco. Si falta, es un error de configuración, no del funcionario. */
  private async leerCertificado(ruta: string): Promise<Buffer> {
    try {
      return await readFile(ruta);
    } catch (causa) {
      this.logger.error('No se encontró el certificado de firma (.p12).', {
        ruta,
        error: causa instanceof Error ? causa.message : String(causa),
      });
      throw new ApplicationError(
        'No se pudo firmar el memorando: falta el certificado de firma en el servidor.',
        502,
        CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE,
      );
    }
  }

  /** La última página del PDF, donde el memorando lleva el bloque de firma. */
  private async ultimaPagina(pdf: Buffer): Promise<number> {
    try {
      const documento = await PDFDocument.load(pdf);
      return documento.getPageCount();
    } catch {
      return 1;
    }
  }
}
