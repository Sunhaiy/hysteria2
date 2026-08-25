import { Module } from '@nestjs/common';
import {
  AdminTutorialsController,
  PublicTutorialsController,
  TutorialImagesController,
} from './tutorials.controller';
import { TutorialsService } from './tutorials.service';

@Module({
  controllers: [
    AdminTutorialsController,
    PublicTutorialsController,
    TutorialImagesController,
  ],
  providers: [TutorialsService],
  exports: [TutorialsService],
})
export class TutorialsModule {}
