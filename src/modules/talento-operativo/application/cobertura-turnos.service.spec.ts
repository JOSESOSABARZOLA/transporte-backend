/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-turnos.service.spec.ts
 * Responsabilidad: Verificar la matriz mensual, la superposición de ausencias y los rechazos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 */

import { EstadoTurno, RolDepartamental } from '@prisma/client';

import { CoberturaTurnosService } from './cobertura-turnos.service';
import type { FuncionariosService } from './funcionarios.service';
import type { CoberturaTurnosRepository } from '../infrastructure/cobertura-turnos.repository';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';

const usuario = {
  usuarioId: 1,
  roles: [RolDepartamental.ADMINISTRADOR_DMIT],
} as unknown as UsuarioAutenticado;

const dia = (d: number): Date => new Date(Date.UTC(2026, 5, d)); // junio 2026

describe('CoberturaTurnosService', () => {
  const funcionarios = { direccionesAlAlcance: jest.fn() };
  const repositorio = {
    personalDeInstruccion: jest.fn(),
    coberturasEnRango: jest.fn(),
    ausenciasEnRango: jest.fn(),
    esDeInstruccion: jest.fn(),
    guardarCelda: jest.fn(),
    actualizarZonaDenominacion: jest.fn(),
  };

  const servicio = new CoberturaTurnosService(
    repositorio as unknown as CoberturaTurnosRepository,
    funcionarios as unknown as FuncionariosService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    funcionarios.direccionesAlAlcance.mockResolvedValue([
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
  });

  it('arma la matriz con turnos, ausencias superpuestas y totales', async () => {
    repositorio.personalDeInstruccion.mockResolvedValue([
      {
        id: 10,
        apellidos: 'PEREZ',
        nombres: 'ANA',
        zonal: { nombre: 'CALDERÓN' },
        denominacion: 'INSTRUCTOR_METROPOLITANO',
      },
    ]);
    repositorio.coberturasEnRango.mockResolvedValue([
      { funcionarioId: 10, fecha: dia(1), estado: EstadoTurno.DIURNO },
      { funcionarioId: 10, fecha: dia(2), estado: EstadoTurno.NOCTURNO },
    ]);
    repositorio.ausenciasEnRango.mockResolvedValue([
      { funcionarioId: 10, desde: dia(3), hasta: dia(4), estado: 'VACACIONES' },
    ]);

    const matriz = await servicio.matriz(usuario, '2026-06');

    expect(matriz.mes).toBe('2026-06');
    expect(matriz.dias).toHaveLength(30);

    const persona = matriz.personas[0];
    expect(persona.zona).toBe('CALDERÓN');
    expect(persona.celdas[0]).toEqual({
      fecha: '2026-06-01',
      estado: 'DIURNO',
      esAusencia: false,
    });
    // La ausencia PISA al turno y no cuenta en los totales.
    expect(persona.celdas[2]).toEqual({
      fecha: '2026-06-03',
      estado: 'VACACIONES',
      esAusencia: true,
    });

    expect(matriz.totales[0]).toEqual({
      fecha: '2026-06-01',
      diurno: 1,
      nocturno: 0,
      activos: 1,
    });
    expect(matriz.totales[2]).toEqual({
      fecha: '2026-06-03',
      diurno: 0,
      nocturno: 0,
      activos: 0,
    });
  });

  it('rechaza editar una celda de alguien fuera del alcance', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(false);

    await expect(
      servicio.editarCelda(usuario, 99, '2026-06-01', EstadoTurno.DIURNO),
    ).rejects.toThrow();
    expect(repositorio.guardarCelda).not.toHaveBeenCalled();
  });

  it('rechaza fijar un turno en un día con ausencia (la manda la disponibilidad)', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(true);
    repositorio.ausenciasEnRango.mockResolvedValue([
      {
        funcionarioId: 10,
        desde: dia(1),
        hasta: dia(1),
        estado: 'REPOSO_MEDICO',
      },
    ]);

    await expect(
      servicio.editarCelda(usuario, 10, '2026-06-01', EstadoTurno.DIURNO),
    ).rejects.toThrow();
    expect(repositorio.guardarCelda).not.toHaveBeenCalled();
  });

  it('guarda la celda cuando la persona está en alcance y el día está libre', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(true);
    repositorio.ausenciasEnRango.mockResolvedValue([]);

    await servicio.editarCelda(usuario, 10, '2026-06-05', EstadoTurno.NOCTURNO);

    expect(repositorio.guardarCelda).toHaveBeenCalledWith(
      10,
      dia(5),
      EstadoTurno.NOCTURNO,
      1,
    );
  });
});
