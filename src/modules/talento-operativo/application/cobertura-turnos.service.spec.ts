/**
 * Microservicio: transporte
 * Módulo: Talento operativo
 * Feature: Cobertura por turnos (Instrucción)
 * Archivo: cobertura-turnos.service.spec.ts
 * Responsabilidad: Verificar la matriz mensual, la superposición de ausencias, la edición y los rechazos.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-09-16
 *
 * 2026-10-05: alcance con 404, limpiar celda, lote con omisiones, totales completos, estado del
 * mes, avisos por parámetro, propuesta de rotación y exportación a Excel.
 */

import * as ExcelJS from 'exceljs';
import {
  EstadoCoberturaMes,
  EstadoTurno,
  RolDepartamental,
} from '@prisma/client';

import { RecursoNoEncontradoError } from '../../../common/errors/errores-dominio';
import { CoberturaTurnosService } from './cobertura-turnos.service';
import type { FuncionariosService } from './funcionarios.service';
import type { ParametroPoliticaService } from '../../configuracion/application/parametro-politica.service';
import type { CoberturaTurnosRepository } from '../infrastructure/cobertura-turnos.repository';
import type { UsuarioAutenticado } from '../../../common/auth/interfaces/usuario-autenticado.interface';

const usuario = {
  usuarioId: 1,
  roles: [RolDepartamental.ADMINISTRADOR_DMIT],
} as unknown as UsuarioAutenticado;

const dia = (d: number): Date => new Date(Date.UTC(2026, 5, d)); // junio 2026

const ANA = {
  id: 10,
  apellidos: 'PEREZ',
  nombres: 'ANA',
  cargo: 'Instructora',
  zonalId: 3,
  zonal: { nombre: 'CALDERÓN' },
  denominacion: 'INSTRUCTOR_METROPOLITANO',
};

describe('CoberturaTurnosService', () => {
  const funcionarios = { direccionesAlAlcance: jest.fn() };
  const parametrosValores: Record<string, string> = {};
  const parametros = {
    obtenerTextoOpcional: jest.fn((clave: string) =>
      Promise.resolve(parametrosValores[clave] ?? ''),
    ),
  };
  const repositorio = {
    personalDeInstruccion: jest.fn(),
    coberturasEnRango: jest.fn(),
    ausenciasEnRango: jest.fn(),
    esDeInstruccion: jest.fn(),
    idsDeInstruccion: jest.fn(),
    guardarCelda: jest.fn(),
    borrarCelda: jest.fn(),
    actualizarZonaDenominacion: jest.fn(),
    estadoMes: jest.fn(),
    publicarMes: jest.fn(),
    marcarConCambios: jest.fn(),
    ejecutarEnTransaccion: jest.fn(
      (operacion: (cliente: unknown) => Promise<unknown>) =>
        operacion('cliente'),
    ),
  };

  const servicio = new CoberturaTurnosService(
    repositorio as unknown as CoberturaTurnosRepository,
    funcionarios as unknown as FuncionariosService,
    parametros as unknown as ParametroPoliticaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    for (const clave of Object.keys(parametrosValores)) {
      delete parametrosValores[clave];
    }
    parametrosValores.COBERTURA_MAX_DIAS_SIN_DESCANSO = '0';
    parametrosValores.COBERTURA_PERMITE_NOCTURNO_A_DIURNO = 'SIN_CONFIGURAR';
    funcionarios.direccionesAlAlcance.mockResolvedValue([
      RolDepartamental.DMIT_INSTRUCTOR,
    ]);
    repositorio.personalDeInstruccion.mockResolvedValue([ANA]);
    repositorio.coberturasEnRango.mockResolvedValue([]);
    repositorio.ausenciasEnRango.mockResolvedValue([]);
    repositorio.estadoMes.mockResolvedValue(null);
  });

  // ─────────────────────── Matriz ───────────────────────

  it('arma la matriz con turnos, ausencias superpuestas, cargo y totales completos', async () => {
    repositorio.coberturasEnRango.mockResolvedValue([
      { funcionarioId: 10, fecha: dia(1), estado: EstadoTurno.DIURNO },
      { funcionarioId: 10, fecha: dia(2), estado: EstadoTurno.NOCTURNO },
      { funcionarioId: 10, fecha: dia(5), estado: EstadoTurno.DESCANSO },
    ]);
    repositorio.ausenciasEnRango.mockResolvedValue([
      { funcionarioId: 10, desde: dia(3), hasta: dia(4), estado: 'VACACIONES' },
    ]);

    const matriz = await servicio.matriz(usuario, '2026-06');

    expect(matriz.mes).toBe('2026-06');
    expect(matriz.dias).toHaveLength(30);
    expect(matriz.estadoMes).toBe(EstadoCoberturaMes.BORRADOR);

    const persona = matriz.personas[0];
    expect(persona.zona).toBe('CALDERÓN');
    expect(persona.cargo).toBe('Instructora');
    expect(persona.celdas[0]).toEqual({
      fecha: '2026-06-01',
      estado: 'DIURNO',
      esAusencia: false,
    });
    // La ausencia PISA al turno.
    expect(persona.celdas[2]).toEqual({
      fecha: '2026-06-03',
      estado: 'VACACIONES',
      esAusencia: true,
    });

    expect(matriz.totales[0]).toMatchObject({
      diurno: 1,
      nocturno: 0,
      descanso: 0,
      ausencias: 0,
      sinTurno: 0,
      activos: 1,
    });
    expect(matriz.totales[2]).toMatchObject({ ausencias: 1, sinTurno: 0 });
    expect(matriz.totales[4]).toMatchObject({ descanso: 1 });
    // Día 6: celda vacía sin ausencia → sin turno.
    expect(matriz.totales[5]).toMatchObject({ sinTurno: 1, activos: 0 });
  });

  it('sin alcance de Instrucción → 404, también en la matriz', async () => {
    funcionarios.direccionesAlAlcance.mockResolvedValue([
      RolDepartamental.DMIP_INSPECCIONES,
    ]);

    await expect(servicio.matriz(usuario, '2026-06')).rejects.toBeInstanceOf(
      RecursoNoEncontradoError,
    );
    await expect(
      servicio.editarLote(usuario, [
        { funcionarioId: 10, fecha: '2026-06-01', estado: EstadoTurno.DIURNO },
      ]),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    await expect(
      servicio.publicarMes(usuario, '2026-06'),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
    expect(repositorio.personalDeInstruccion).not.toHaveBeenCalled();
  });

  // ─────────────────────── Celda ───────────────────────

  it('rechaza editar una celda de alguien fuera del alcance', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(false);

    await expect(
      servicio.editarCelda(usuario, 99, '2026-06-01', EstadoTurno.DIURNO),
    ).rejects.toBeInstanceOf(RecursoNoEncontradoError);
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

  it('guarda la celda y marca «con cambios» el mes si estaba publicado', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(true);

    await servicio.editarCelda(usuario, 10, '2026-06-05', EstadoTurno.NOCTURNO);

    expect(repositorio.guardarCelda).toHaveBeenCalledWith(
      10,
      dia(5),
      EstadoTurno.NOCTURNO,
      1,
      'cliente',
    );
    expect(repositorio.marcarConCambios).toHaveBeenCalledWith(
      ['2026-06'],
      RolDepartamental.DMIT_INSTRUCTOR,
      'cliente',
    );
  });

  it('limpiar la celda (estado null) borra el turno, no lo guarda', async () => {
    repositorio.esDeInstruccion.mockResolvedValue(true);

    await servicio.editarCelda(usuario, 10, '2026-06-05', null);

    expect(repositorio.borrarCelda).toHaveBeenCalledWith(10, dia(5), 'cliente');
    expect(repositorio.guardarCelda).not.toHaveBeenCalled();
  });

  // ─────────────────────── Lote ───────────────────────

  it('lote: aplica las válidas y omite ausencia, fuera de alcance y otra área', async () => {
    // 10 (Ana) en alcance; 20 es de otra área o ajena: no vuelve en idsDeInstruccion.
    repositorio.idsDeInstruccion.mockResolvedValue(new Set([10]));
    repositorio.ausenciasEnRango.mockResolvedValue([
      { funcionarioId: 10, desde: dia(3), hasta: dia(3), estado: 'VACACIONES' },
    ]);

    const resultado = await servicio.editarLote(usuario, [
      { funcionarioId: 10, fecha: '2026-06-01', estado: EstadoTurno.DIURNO },
      { funcionarioId: 10, fecha: '2026-06-02', estado: null },
      { funcionarioId: 10, fecha: '2026-06-03', estado: EstadoTurno.DIURNO },
      { funcionarioId: 20, fecha: '2026-06-01', estado: EstadoTurno.NOCTURNO },
    ]);

    expect(resultado.aplicadas).toBe(2);
    expect(resultado.omitidas).toEqual([
      {
        funcionarioId: 10,
        fecha: '2026-06-03',
        motivo: 'Ausencia registrada ese día.',
      },
      {
        funcionarioId: 20,
        fecha: '2026-06-01',
        motivo: 'Fuera de su alcance o no es personal de Instrucción.',
      },
    ]);
    expect(repositorio.guardarCelda).toHaveBeenCalledTimes(1);
    expect(repositorio.borrarCelda).toHaveBeenCalledWith(10, dia(2), 'cliente');
    // Todo en UNA transacción.
    expect(repositorio.ejecutarEnTransaccion).toHaveBeenCalledTimes(1);
    expect(repositorio.marcarConCambios).toHaveBeenCalledWith(
      ['2026-06'],
      RolDepartamental.DMIT_INSTRUCTOR,
      'cliente',
    );
  });

  // ─────────────────────── Estado del mes ───────────────────────

  it('publicar el mes lo deja PUBLICADO y cuenta las celdas vacías', async () => {
    repositorio.publicarMes.mockResolvedValue({
      estado: EstadoCoberturaMes.PUBLICADO,
    });
    repositorio.coberturasEnRango.mockResolvedValue([
      { funcionarioId: 10, fecha: dia(1), estado: EstadoTurno.DIURNO },
    ]);

    const resultado = await servicio.publicarMes(usuario, '2026-06');

    expect(resultado.estadoMes).toBe(EstadoCoberturaMes.PUBLICADO);
    expect(resultado.celdasVacias).toBe(29);
    expect(repositorio.publicarMes).toHaveBeenCalledWith(
      '2026-06',
      RolDepartamental.DMIT_INSTRUCTOR,
      1,
    );
  });

  it('la matriz devuelve el estado del mes guardado', async () => {
    repositorio.estadoMes.mockResolvedValue({
      estado: EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS,
    });

    const matriz = await servicio.matriz(usuario, '2026-06');

    expect(matriz.estadoMes).toBe(EstadoCoberturaMes.PUBLICADO_CON_CAMBIOS);
  });

  // ─────────────────────── Avisos ───────────────────────

  it('con los parámetros apagados no hay avisos', async () => {
    repositorio.coberturasEnRango.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) => ({
        funcionarioId: 10,
        fecha: dia(i + 1),
        estado: EstadoTurno.DIURNO,
      })),
    );

    const matriz = await servicio.matriz(usuario, '2026-06');

    expect(matriz.avisosConfigurados).toBe(false);
    expect(matriz.personas[0].avisos).toBe(0);
  });

  it('con el máximo configurado, la racha que lo excede avisa en la celda', async () => {
    parametrosValores.COBERTURA_MAX_DIAS_SIN_DESCANSO = '6';
    repositorio.coberturasEnRango.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        funcionarioId: 10,
        fecha: dia(i + 1),
        estado: EstadoTurno.DIURNO,
      })),
    );

    const matriz = await servicio.matriz(usuario, '2026-06');

    expect(matriz.avisosConfigurados).toBe(true);
    // Días 7 y 8 exceden el máximo de 6.
    expect(matriz.personas[0].avisos).toBe(2);
    expect(matriz.personas[0].celdas[6].aviso).toContain('7 días seguidos');
    expect(matriz.personas[0].celdas[5].aviso).toBeUndefined();
  });

  // ─────────────────────── Rotación ───────────────────────

  it('propuesta de rotación: continúa el ciclo solo en celdas vacías', async () => {
    // Ciclo 2D+1— repetido los días 1 a 6; del 7 al 30 vacío salvo el 10 ya planificado.
    const ciclo = [
      EstadoTurno.DIURNO,
      EstadoTurno.DIURNO,
      EstadoTurno.DESCANSO,
    ];
    const planificado = Array.from({ length: 6 }, (_, i) => ({
      funcionarioId: 10,
      fecha: dia(i + 1),
      estado: ciclo[i % 3],
    }));
    planificado.push({
      funcionarioId: 10,
      fecha: dia(10),
      estado: EstadoTurno.DIURNO,
    });
    repositorio.coberturasEnRango.mockResolvedValue(planificado);

    const resultado = await servicio.proponerRotacion(usuario, '2026-06');

    expect(resultado.personas).toBe(1);
    // No propone sobre el día 10 (ya planificado) ni sobre los días 1-6.
    const fechas = resultado.propuestas.map((p) => p.fecha);
    expect(fechas).not.toContain('2026-06-10');
    expect(fechas).not.toContain('2026-06-01');
    expect(
      resultado.propuestas.find((p) => p.fecha === '2026-06-07')?.estado,
    ).toBe(EstadoTurno.DIURNO);
    expect(
      resultado.propuestas.find((p) => p.fecha === '2026-06-09')?.estado,
    ).toBe(EstadoTurno.DESCANSO);
  });

  // ─────────────────────── Exportar ───────────────────────

  it('exporta un .xlsx válido con las cabeceras del formato y el estado coloreado', async () => {
    repositorio.coberturasEnRango.mockResolvedValue([
      { funcionarioId: 10, fecha: dia(1), estado: EstadoTurno.DIURNO },
    ]);

    const buffer = await servicio.exportar(usuario, '2026-06');

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    const hoja = libro.worksheets[0];
    const cabecera = hoja.getRow(1).values as unknown[];
    expect(cabecera).toEqual(
      expect.arrayContaining([
        'ZONA',
        'DENOMINACIÓN',
        'PERSONAL',
        'LUNES 01',
        'REVISIÓN',
        'OBSERVACIÓN',
      ]),
    );
    const celda = hoja.getRow(2).getCell(4);
    expect(celda.value).toBe('DIURNO');
    expect(celda.fill).toMatchObject({
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFF2CC' },
    });
    // Filas de totales al final.
    const rotulos = [hoja.getRow(3), hoja.getRow(4), hoja.getRow(5)].map(
      (fila) => fila.getCell(3).value,
    );
    expect(rotulos).toEqual(['Diurnos', 'Nocturnos', 'Descansos']);
  });
});
