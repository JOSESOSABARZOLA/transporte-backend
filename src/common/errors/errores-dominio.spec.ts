/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Manejo de errores
 * Archivo: errores-dominio.spec.ts
 * Responsabilidad: Verificar que cada error lleva su estado HTTP y su código.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 */

import { ApplicationError } from './application.error';
import { CODIGOS_ERROR } from './codigos-error';
import {
  AutorizacionError,
  ConflictoConcurrenciaError,
  RecursoNoEncontradoError,
  ReglaNegocioError,
  ValidacionError,
  VentanaCerradaError,
} from './errores-dominio';

describe('Jerarquía de errores', () => {
  it('todos heredan de ApplicationError, para que el filtro los reconozca', () => {
    const errores = [
      new ValidacionError('x'),
      new AutorizacionError(CODIGOS_ERROR.ROL_NO_AUTORIZADO, 'x'),
      new RecursoNoEncontradoError('x'),
      new ReglaNegocioError(CODIGOS_ERROR.PATRULLA_CONSECUTIVA, 'x'),
      new ConflictoConcurrenciaError('x'),
      new VentanaCerradaError('x'),
    ];
    for (const error of errores) {
      expect(error).toBeInstanceOf(ApplicationError);
    }
  });

  it('asigna el estado HTTP de FASE4 §13.1', () => {
    expect(new ValidacionError('x').statusCode).toBe(400);
    expect(
      new AutorizacionError(CODIGOS_ERROR.ROL_NO_AUTORIZADO, 'x').statusCode,
    ).toBe(403);
    expect(new RecursoNoEncontradoError('x').statusCode).toBe(404);
    expect(
      new ReglaNegocioError(CODIGOS_ERROR.PATRULLA_CONSECUTIVA, 'x').statusCode,
    ).toBe(409);
    expect(new ConflictoConcurrenciaError('x').statusCode).toBe(409);
    expect(new VentanaCerradaError('x').statusCode).toBe(423);
  });

  it('la ventana cerrada usa 423 y no 403: el rol tiene permiso, no tiene el momento', () => {
    const error = new VentanaCerradaError(
      'La ventana de carga de su departamento cerró a las 15H00.',
    );
    expect(error.statusCode).toBe(423);
    expect(error.code).toBe(CODIGOS_ERROR.VENTANA_CARGA_CERRADA);
  });

  it('conserva el código y los detalles que recibe', () => {
    const error = new ReglaNegocioError(
      CODIGOS_ERROR.PATRULLA_CONSECUTIVA,
      'BENAVIDES FERNANDO salió en patrulla ayer.',
      { funcionarioId: 118, fechaUltimaPatrulla: '2026-07-30' },
    );
    expect(error.code).toBe('PATRULLA_CONSECUTIVA');
    expect(error.message).toContain('BENAVIDES FERNANDO');
    expect(error.details).toEqual({
      funcionarioId: 118,
      fechaUltimaPatrulla: '2026-07-30',
    });
  });

  it('declara los quince códigos de la guía §11.3, más los nueve que se agregaron después', () => {
    // La guía §11.3 enumera quince. `AREA_NO_ADMITIDA` es el decimosexto: el plan exige
    // responder 409 cuando la persona es de un área que el formulario no admite, y
    // ninguno de los quince describe ese rechazo. Ver M15_ASIGNACION_PERSONAL.md §4.
    //
    // El diecisiete y el dieciocho llegaron con el adicional del día, el 2026-08-20, y van
    // separados aunque nazcan del mismo vínculo: la pantalla reacciona distinto a cada uno.
    //
    // El diecinueve, `AUTH_NO_DISPONIBLE`, es del 2026-08-21 y **no habla del negocio sino
    // de una dependencia**. Existe porque sin él el fallo de Auth caía en el genérico y la
    // pantalla mostraba «No se pudo completar la operación» en lugar del motivo redactado.
    // El veinte, `APORTE_COMPARTIDO_PENDIENTE`, es del 2026-08-25: la patrulla compartida
    // que se cierra sin el personal que aporta el otro departamento. Es el ESPEJO de
    // `CUPO_COMPARTIDO_SUPERADO` —aquél sobra, éste falta— y por eso no se reutiliza:
    // uno se corrige quitando a alguien y el otro añadiéndolo.
    // El veintiuno, `VEHICULO_OCUPADO`, es del 2026-08-28 y cierra RN-DAF-01: hasta esa
    // fecha la misma placa podía servir a varios operativos cruzados sin ningún aviso.
    // Es el ESPEJO de `SOLAPAMIENTO_HORARIO` sobre un activo en lugar de una persona, y
    // se separa por lo mismo que los dos anteriores: uno se corrige cambiando de
    // conductor y el otro cambiando de vehículo, que son dos desplegables distintos.
    // El veintidós, `PERSONA_EN_DESCANSO`, es del 2026-09-16: el turno DESCANSO de la
    // cobertura por turnos de Instrucción excluye a la persona ese día. Va separado de
    // `PERSONA_NO_DISPONIBLE` (ausencia de `t_disponibilidad`) porque es otra fuente y
    // se corrige en otra pantalla: la matriz de cobertura, no el registro de ausencias.
    // El veintitrés, `TURNO_FUERA_DE_RANGO`, es del mismo día: si la persona tiene turno
    // diurno o nocturno, el horario del operativo debe caer dentro de esa ventana (los
    // parámetros HORA_TURNO_*). Es otra regla distinta del descanso, con su propia pantalla.
    // El veinticuatro, `PERMISO_INSUFICIENTE`, es del 2026-09-16 (RBAC): el perfil no tiene
    // el permiso atómico que el endpoint exige. Lo lanza `PermisosGuard` en lugar del 403
    // genérico, para que el frontend distinga «sin permiso» de otros rechazos.
    // El veinticinco, `SERVICIO_FIRMA_NO_DISPONIBLE`, es del 2026-09-22: un 502 cuando la firma
    // digital está CONFIGURADA y el servicio externo (.p12) falla al firmar el memorando. No
    // habla del negocio sino de una dependencia, como `AUTH_NO_DISPONIBLE`.
    // El veintiséis, `CATALOGO_EN_USO`, es del 2026-09-24: un 409 al intentar ELIMINAR (baja
    // física) un valor de catálogo ya usado en operativos, o una zonal con puntos.
    expect(Object.keys(CODIGOS_ERROR)).toHaveLength(26);
    expect(CODIGOS_ERROR.SERVICIO_FIRMA_NO_DISPONIBLE).toBe(
      'SERVICIO_FIRMA_NO_DISPONIBLE',
    );
    expect(CODIGOS_ERROR.CATALOGO_EN_USO).toBe('CATALOGO_EN_USO');
    expect(CODIGOS_ERROR.PERMISO_INSUFICIENTE).toBe('PERMISO_INSUFICIENTE');
    expect(CODIGOS_ERROR.PERSONA_EN_DESCANSO).toBe('PERSONA_EN_DESCANSO');
    expect(CODIGOS_ERROR.TURNO_FUERA_DE_RANGO).toBe('TURNO_FUERA_DE_RANGO');
    expect(CODIGOS_ERROR.VEHICULO_OCUPADO).toBe('VEHICULO_OCUPADO');
    expect(CODIGOS_ERROR.APORTE_COMPARTIDO_PENDIENTE).toBe(
      'APORTE_COMPARTIDO_PENDIENTE',
    );
    expect(CODIGOS_ERROR.AREA_NO_ADMITIDA).toBe('AREA_NO_ADMITIDA');
    expect(CODIGOS_ERROR.ADICIONAL_NO_ENCADENABLE).toBe(
      'ADICIONAL_NO_ENCADENABLE',
    );
    expect(CODIGOS_ERROR.OPERATIVO_CON_ADICIONALES).toBe(
      'OPERATIVO_CON_ADICIONALES',
    );
    expect(CODIGOS_ERROR.AUTH_NO_DISPONIBLE).toBe('AUTH_NO_DISPONIBLE');
  });
});
