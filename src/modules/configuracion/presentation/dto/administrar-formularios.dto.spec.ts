/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Formularios y catálogos
 * Archivo: administrar-formularios.dto.spec.ts
 * Responsabilidad: Fijar que número, código y áreas se rechazan con 400 y un mensaje claro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 *
 * Se usa el MISMO `ValidationPipe` que `main.ts` (whitelist + forbidNonWhitelisted + transform):
 * lo que se prueba es el borde real, no la clase suelta.
 */

import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { MENSAJES_CAMPO_FIJO } from '../../application/politicas/formulario-admin';
import {
  ActualizarFormularioDto,
  CrearFormularioDto,
} from './administrar-formularios.dto';

const tubo = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

/** Los mensajes del 400, o `[]` si el cuerpo pasa. */
async function mensajesDe(
  clase: typeof CrearFormularioDto | typeof ActualizarFormularioDto,
  cuerpo: Record<string, unknown>,
): Promise<string[]> {
  try {
    await tubo.transform(cuerpo, { type: 'body', metatype: clase });
    return [];
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const respuesta = error.getResponse() as { message: string[] };
    return respuesta.message;
  }
}

const ALTA = {
  numero: 11,
  codigo: 'NUEVO',
  nombre: 'Formulario nuevo',
  colorFondo: '#A2C4C9',
  colorAcento: '#000000',
  colorNombre: 'Verde azulado',
  rolDueno: 'DMIP_OPERATIVOS',
  prefijo: 'OCN',
};

describe('CrearFormularioDto', () => {
  it('un alta sin áreas es válida', async () => {
    await expect(mensajesDe(CrearFormularioDto, ALTA)).resolves.toEqual([]);
  });

  it('un alta con áreas se rechaza: se configuran en Catálogos', async () => {
    await expect(
      mensajesDe(CrearFormularioDto, { ...ALTA, areas: ['OPERATIVOS'] }),
    ).resolves.toEqual([MENSAJES_CAMPO_FIJO.areas]);
  });
});

describe('ActualizarFormularioDto', () => {
  it('cambiar el nombre es válido', async () => {
    await expect(
      mensajesDe(ActualizarFormularioDto, { nombre: 'Otro nombre' }),
    ).resolves.toEqual([]);
  });

  it.each([
    ['numero', 12, MENSAJES_CAMPO_FIJO.numero],
    ['codigo', 'OTRO', MENSAJES_CAMPO_FIJO.codigo],
    ['areas', [], MENSAJES_CAMPO_FIJO.areas],
  ])('rechaza «%s» con su mensaje', async (campo, valor, mensaje) => {
    await expect(
      mensajesDe(ActualizarFormularioDto, { [campo]: valor }),
    ).resolves.toEqual([mensaje]);
  });
});
