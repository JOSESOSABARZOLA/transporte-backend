/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Órdenes de servicio
 * Archivo: guardar-plantilla.dto.spec.ts
 * Responsabilidad: Fijar que el contrato de la plantilla acepta TODOS los datos generales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-05
 *
 * EL DEFECTO QUE ORIGINA ESTA PRUEBA. `DatosGeneralesDto` declaraba cuatro de los siete datos
 * generales; el editor enviaba también los del firmante y el `ValidationPipe` global
 * (`whitelist` + `forbidNonWhitelisted`) respondía 400: la vista previa no se generaba y guardar
 * fallaba con «No se pudo completar la operación». Se prueba con el MISMO pipe que `main.ts`.
 */

import { BadRequestException, ValidationPipe } from '@nestjs/common';

import { GuardarPlantillaDto } from './guardar-plantilla.dto';
import { PrevisualizarPlantillaDto } from './previsualizar-plantilla.dto';

/** El pipe con la misma configuración que el global de `main.ts`. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const DATOS_GENERALES = {
  direccionResponsable: 'Dirección Metropolitana de Inspección',
  numeroMemorando: 'GADDMQ-AMC-DMIP-2026-9379-M',
  fechaMemorando: '2026-06-17',
  designado: 'Mgs. Ana Simbaña (Funcionario Directivo 9)',
  firmante: 'Mgs. Ana Simbaña',
  firmanteCargo: 'Funcionario Directivo 9',
  firmanteDependencia: 'Dirección Metropolitana de Inspección',
};

const APARTADOS = [
  { id: 'a', titulo: 'PRIMERO', tipo: 'texto', contenido: 'Texto.' },
];

const validar = (metatype: new () => object, cuerpo: unknown) =>
  pipe.transform(cuerpo, { type: 'body', metatype });

describe('Contrato de la plantilla · datos generales', () => {
  it('guardar acepta los SIETE datos generales, firmante incluido (sin 400)', async () => {
    await expect(
      validar(GuardarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: DATOS_GENERALES,
      }),
    ).resolves.toBeDefined();
  });

  it('la vista previa acepta la plantilla en borrador con los siete datos generales', async () => {
    await expect(
      validar(PrevisualizarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: DATOS_GENERALES,
      }),
    ).resolves.toBeDefined();
  });

  it('la vista previa TOLERA el `codigo` del editor anterior (compatibilidad): no da 400', async () => {
    // Una pestaña abierta antes del despliegue aún lo envía; se acepta y el controlador lo ignora.
    await expect(
      validar(PrevisualizarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: DATOS_GENERALES,
        codigo: 'OS-ICNECU-001-101-1',
      }),
    ).resolves.toBeDefined();
  });

  it('el `codigo` tolerado sigue acotado: un texto desmedido se rechaza', async () => {
    await expect(
      validar(PrevisualizarPlantillaDto, {
        apartados: APARTADOS,
        codigo: 'X'.repeat(121),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('guardar la plantilla sigue SIN admitir `codigo`', async () => {
    await expect(
      validar(GuardarPlantillaDto, {
        apartados: APARTADOS,
        codigo: 'OS-ICNECU-001-101-1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('un campo fuera de contrato dentro de los datos generales sigue rechazándose', async () => {
    await expect(
      validar(GuardarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: { ...DATOS_GENERALES, intruso: 'x' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('Contrato de la plantilla · tabla de control (2026-10-08)', () => {
  const TABLA = {
    accion: 'Elaborado por',
    elaboradoPor: 'Jose Sosa',
    siglasUnidad: 'dmi',
  };

  it('acepta acción, quién elabora y siglas, y guarda las siglas en mayúsculas', async () => {
    const dto = (await validar(GuardarPlantillaDto, {
      apartados: APARTADOS,
      datosGenerales: { ...DATOS_GENERALES, ...TABLA },
    })) as GuardarPlantillaDto;

    expect(dto.datosGenerales).toEqual(
      expect.objectContaining({
        accion: 'Elaborado por',
        elaboradoPor: 'Jose Sosa',
        siglasUnidad: 'DMI',
      }),
    );
  });

  it('las siglas no pasan de 20 caracteres', async () => {
    await expect(
      validar(GuardarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: { ...DATOS_GENERALES, siglasUnidad: 'A'.repeat(21) },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      validar(GuardarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: { ...DATOS_GENERALES, siglasUnidad: 'A'.repeat(20) },
      }),
    ).resolves.toBeDefined();
  });

  it('la vista previa acepta también la tabla de control en edición', async () => {
    await expect(
      validar(PrevisualizarPlantillaDto, {
        apartados: APARTADOS,
        datosGenerales: { ...DATOS_GENERALES, ...TABLA },
      }),
    ).resolves.toBeDefined();
  });
});
