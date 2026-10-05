/**
 * Microservicio: transporte
 * Módulo: Cuadro de Colores
 * Feature: Identidad y acceso
 * Archivo: identidad.module.ts
 * Responsabilidad: Componer el submódulo de sesión con Auth central.
 * Desarrollador: Jose Sosa
 * Fecha: 2026-08-17
 *
 * SÉPTIMO SUBMÓDULO, y el primero que no es de negocio. Los seis de
 * docs/IMPLEMENTATION_GUIDE.md §6 son contextos del cuadro; éste es el ingreso al
 * sistema, que no pertenece a ninguno de ellos y los precede a todos.
 *
 * NO EXPORTA NADA. Ningún submódulo de negocio necesita hablar con la sesión: la
 * identidad les llega ya resuelta en `request.user`, que es lo que pone `IdentidadGuard`.
 * Un submódulo que exporta lo que nadie importa acaba importándose «por si acaso».
 */

import { Module } from '@nestjs/common';

import { TalentoOperativoModule } from '../talento-operativo/talento-operativo.module';
import { DirectorioAuthService } from './application/directorio-auth.service';
import { SesionService } from './application/sesion.service';
import { UsuariosAdminService } from './application/usuarios-admin.service';
import { AuthUsuariosClient } from './infrastructure/auth-usuarios.client';
import { UsuarioSesionRepository } from './infrastructure/usuario-sesion.repository';
import { UsuariosAdminRepository } from './infrastructure/usuarios-admin.repository';
import { AdministracionUsuariosController } from './presentation/administracion-usuarios.controller';
import { DirectorioController } from './presentation/directorio.controller';
import { SesionController } from './presentation/sesion.controller';

@Module({
  /**
   * SE IMPORTA `TalentoOperativoModule` desde el 2026-08-21, y es la primera dependencia
   * de este submódulo hacia uno de negocio.
   *
   * El directorio cruza lo que Auth sabe con las fichas de personal, y las fichas son de
   * allí. Preguntárselo a `FuncionariosService` —un servicio publicado— es lo que evita
   * que este submódulo lea `t_funcionario` por su cuenta, que es la regla 3 del stack.
   *
   * No hay ciclo: `talento-operativo` no conoce a `identidad`.
   */
  imports: [TalentoOperativoModule],
  controllers: [
    SesionController,
    AdministracionUsuariosController,
    DirectorioController,
  ],
  providers: [
    SesionService,
    UsuarioSesionRepository,
    UsuariosAdminService,
    UsuariosAdminRepository,
    DirectorioAuthService,
    AuthUsuariosClient,
  ],
})
export class IdentidadModule {}
