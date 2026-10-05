/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Trazabilidad
 * Archivo: logger.service.spec.ts
 * Responsabilidad: Verificar que los datos personales nunca salen en un registro.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * Es la prueba que respalda la prohibición de FASE4 §12.4. No comprueba que el
 * programador recuerde no registrar un teléfono: comprueba que, aunque lo pase,
 * el servicio no lo emite.
 */

import { suprimirDatosPersonales } from './logger.service';

describe('suprimirDatosPersonales', () => {
  it('suprime el teléfono y la cédula', () => {
    const resultado = suprimirDatosPersonales({
      funcionarioId: 118,
      telefono: '98 514 4231',
      cedula: '1700000001',
    });
    expect(resultado).toEqual({
      funcionarioId: 118,
      telefono: '[suprimido]',
      cedula: '[suprimido]',
    });
  });

  it('suprime el contenido de la orden de servicio', () => {
    const resultado = suprimirDatosPersonales({
      ordenId: 12,
      datoAislado: { horario: '18H00 A 23H30', funcionario: 'YUNDA JESSICA' },
    });
    expect(resultado).toEqual({ ordenId: 12, datoAislado: '[suprimido]' });
  });

  it('suprime credenciales y tokens', () => {
    const resultado = suprimirDatosPersonales({
      token: 'abc',
      authorization: 'Bearer abc',
      password: 'x',
      claveAcceso: 'y',
      contraseña: 'z',
    });
    expect(resultado).toEqual({
      token: '[suprimido]',
      authorization: '[suprimido]',
      password: '[suprimido]',
      claveAcceso: '[suprimido]',
      contraseña: '[suprimido]',
    });
  });

  describe('nombres compuestos, mayúsculas y acentos', () => {
    it('suprime aunque el nombre lleve sufijo o prefijo', () => {
      const resultado = suprimirDatosPersonales({
        telefonoContacto: '099',
        cedulaFuncionario: '1700000001',
        accessToken: 'abc',
        oser_dato_aislado: { horario: 'x' },
      });
      expect(resultado).toEqual({
        telefonoContacto: '[suprimido]',
        cedulaFuncionario: '[suprimido]',
        accessToken: '[suprimido]',
        oser_dato_aislado: '[suprimido]',
      });
    });

    it('no depende de las mayúsculas', () => {
      expect(
        suprimirDatosPersonales({ Telefono: '099', CEDULA: '17' }),
      ).toEqual({ Telefono: '[suprimido]', CEDULA: '[suprimido]' });
    });

    it('deja pasar `clave`: es la clave de un parámetro, no una contraseña', () => {
      expect(
        suprimirDatosPersonales({ clave: 'JORNADA_MAXIMA_HORAS' }),
      ).toEqual({ clave: 'JORNADA_MAXIMA_HORAS' });
    });
  });

  describe('estructuras que podrían tumbar al registrador', () => {
    it('corta las referencias circulares en lugar de desbordar la pila', () => {
      const nodo: Record<string, unknown> = { id: 1 };
      nodo.mismo = nodo;

      expect(suprimirDatosPersonales(nodo)).toEqual({
        id: 1,
        mismo: '[referencia circular]',
      });
    });

    it('corta el anidamiento desmedido', () => {
      const raiz: Record<string, unknown> = {};
      let actual = raiz;
      for (let nivel = 0; nivel < 12; nivel += 1) {
        const hijo: Record<string, unknown> = {};
        actual.hijo = hijo;
        actual = hijo;
      }

      expect(JSON.stringify(suprimirDatosPersonales(raiz))).toContain(
        '[profundidad excedida]',
      );
    });

    it('normaliza las fechas para que sean legibles', () => {
      const resultado = suprimirDatosPersonales({
        momento: new Date('2026-08-05T12:00:00.000Z'),
      });
      expect(resultado).toEqual({ momento: '2026-08-05T12:00:00.000Z' });
    });
  });

  it('recorre objetos anidados', () => {
    const resultado = suprimirDatosPersonales({
      operativo: { id: 5120, responsable: { nombre: 'X', telefono: '099' } },
    });
    expect(resultado).toEqual({
      operativo: {
        id: 5120,
        responsable: { nombre: 'X', telefono: '[suprimido]' },
      },
    });
  });

  it('recorre arreglos', () => {
    const resultado = suprimirDatosPersonales([
      { cedula: '1' },
      { cedula: '2' },
    ]);
    expect(resultado).toEqual([
      { cedula: '[suprimido]' },
      { cedula: '[suprimido]' },
    ]);
  });

  it('deja intacto lo que no es sensible', () => {
    const resultado = suprimirDatosPersonales({
      operacion: 'POST /operativos',
      duracionMs: 42,
      estado: 201,
    });
    expect(resultado).toEqual({
      operacion: 'POST /operativos',
      duracionMs: 42,
      estado: 201,
    });
  });
});
