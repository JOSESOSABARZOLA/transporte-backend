/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Talento operativo
 * Archivo: talento-operativo.module.ts
 * Responsabilidad: Componer el submódulo de personal y publicar sus servicios.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-05
 *
 * CTX-03 · Talento Operativo. Aquí viven el maestro de personal, su disponibilidad y
 * —a partir de M-12— **todas las reglas de descanso**. Si alguna aparece en otro
 * submódulo, es un defecto: ver la regla 1 de CLAUDE.md.
 *
 * IMPORTA `ConfiguracionModule` para preguntarle qué áreas admite un formulario. Es
 * una dependencia por SERVICIO PUBLICADO —`FormulariosService`—, nunca por repositorio,
 * y no crea ciclo: la configuración no sabe nada del personal.
 *
 * | Servicio | Quién lo consumirá |
 * |---|---|
 * | `FuncionariosService` | `documentos` (M-24) para las órdenes de servicio |
 * | `DisponibilidadService` | `operativos` (M-14) al validar una asignación |
 * | `PersonalElegibleService` | `operativos` (M-14). En M-12 pasa a devolver el veredicto completo de las políticas de descanso |
 * | `HistorialJornadaService` | `cuadro-diario` (M-13) al cerrar la jornada, y las políticas de descanso (M-12) |
 */

import { Module } from '@nestjs/common';

import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { AuthDirectorioModule } from '../identidad/auth-directorio.module';
import { CoberturaTurnosService } from './application/cobertura-turnos.service';
import { DisponibilidadService } from './application/disponibilidad.service';
import { ElegibilidadService } from './application/elegibilidad.service';
import { FuncionariosService } from './application/funcionarios.service';
import { HistorialJornadaService } from './application/historial-jornada.service';
import { PersonalElegibleService } from './application/personal-elegible.service';
import { DisponibilidadRepository } from './infrastructure/disponibilidad.repository';
import { ElegibilidadRepository } from './infrastructure/elegibilidad.repository';
import { CoberturaTurnosRepository } from './infrastructure/cobertura-turnos.repository';
import { FuncionariosRepository } from './infrastructure/funcionarios.repository';
import { HistorialJornadaRepository } from './infrastructure/historial-jornada.repository';
import { RolDireccionRepository } from './infrastructure/rol-direccion.repository';
import { AdministracionPersonalController } from './presentation/administracion-personal.controller';
import { PersonalController } from './presentation/personal.controller';

/**
 * `HistorialJornadaService` se registra SIN CONTROLADOR, a propósito. RN-35: el
 * acumulado de salidas no se muestra nunca en la interfaz. Que no exista una ruta que
 * lo exponga no es un descuido, es la decisión.
 */
@Module({
  // AuthDirectorioModule (2026-10-08): el alta de origen AUTH toma de Auth el correo
  // institucional. Es un módulo sin dependencias: no crea ciclo con IdentidadModule.
  imports: [ConfiguracionModule, AuthDirectorioModule],
  controllers: [AdministracionPersonalController, PersonalController],
  providers: [
    FuncionariosService,
    FuncionariosRepository,
    RolDireccionRepository,
    CoberturaTurnosService,
    CoberturaTurnosRepository,
    DisponibilidadService,
    DisponibilidadRepository,
    PersonalElegibleService,
    HistorialJornadaService,
    HistorialJornadaRepository,
    ElegibilidadService,
    ElegibilidadRepository,
  ],
  exports: [
    FuncionariosService,
    DisponibilidadService,
    PersonalElegibleService,
    HistorialJornadaService,
    ElegibilidadService,
  ],
})
export class TalentoOperativoModule {}
