/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Utilidades transversales
 * Archivo: texto.spec.ts
 * Responsabilidad: Fijar cómo se guardan los nombres de tipos de control y de zonales.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-10-13
 */
import { aFormatoTitulo, enMayusculas } from './texto';

describe('enMayusculas · tipos de control', () => {
  it('pasa a mayúsculas conservando las tildes y recorta espacios', () => {
    expect(enMayusculas('  reinspección   por falta de elementos ')).toBe(
      'REINSPECCIÓN POR FALTA DE ELEMENTOS',
    );
    expect(enMayusculas('Control de todas las competencias de AMC')).toBe(
      'CONTROL DE TODAS LAS COMPETENCIAS DE AMC',
    );
  });
});

describe('aFormatoTitulo · zonales', () => {
  // Los once nombres vigentes en desarrollo: el formato no debe cambiar ninguno.
  it.each([
    'Zonal Eugenio Espejo',
    'Zonal La Delicia',
    'Zonal Calderón',
    'Zonal Eloy Alfaro',
    'Zonal Quitumbe',
    'Zonal La Mariscal',
    'Zonal Manuela Sáenz',
    'Zonal Valle de los Chillos',
    'Zonal Tumbaco',
    'Zonal Chocó Andino',
    'DMQ',
  ])('deja «%s» igual', (nombre) => {
    expect(aFormatoTitulo(nombre)).toBe(nombre);
  });

  it('capitaliza un nombre escrito todo en mayúsculas, con conectores en minúscula', () => {
    expect(aFormatoTitulo('ZONAL VALLE DE LOS CHILLOS')).toBe(
      'Zonal Valle de los Chillos',
    );
    expect(aFormatoTitulo('ZONAL LA DELICIA')).toBe('Zonal La Delicia');
    expect(aFormatoTitulo('HOSPITAL CARLOS ANDRADE MARIN')).toBe(
      'Hospital Carlos Andrade Marin',
    );
  });

  it('capitaliza un nombre en minúsculas y colapsa espacios', () => {
    expect(aFormatoTitulo('  zonal   la  mariscal ')).toBe('Zonal La Mariscal');
  });

  it('respeta una sigla escrita en mayúsculas dentro de un nombre mixto, y siempre DMQ', () => {
    expect(aFormatoTitulo('Zonal AMC norte')).toBe('Zonal AMC Norte');
    expect(aFormatoTitulo('dmq')).toBe('DMQ');
  });
});
