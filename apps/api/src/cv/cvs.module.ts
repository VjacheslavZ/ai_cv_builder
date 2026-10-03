import { Module } from '@nestjs/common';
import { CvsController } from './cvs.controller.js';
import { CvsRepository } from './cvs.repository.js';

@Module({ controllers: [CvsController], providers: [CvsRepository] })
export class CvsModule {}
