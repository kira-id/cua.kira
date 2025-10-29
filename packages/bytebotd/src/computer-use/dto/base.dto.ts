import { IsNumber, Min, Max } from 'class-validator';
import { Transform } from 'class-transformer';

export class CoordinatesDto {
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => {
    // Ensure non-negative values
    const num = Number(value);
    return isNaN(num) ? 0 : Math.max(0, num);
  })
  x: number;

  @IsNumber()
  @Min(0)
  @Transform(({ value }) => {
    // Ensure non-negative values
    const num = Number(value);
    return isNaN(num) ? 0 : Math.max(0, num);
  })
  y: number;
}

export enum ButtonType {
  LEFT = 'left',
  RIGHT = 'right',
  MIDDLE = 'middle',
}

export enum PressType {
  UP = 'up',
  DOWN = 'down',
}

export enum ScrollDirection {
  UP = 'up',
  DOWN = 'down',
  LEFT = 'left',
  RIGHT = 'right',
}

export enum ApplicationName {
  FIREFOX = 'firefox',
  ONEPASSWORD = '1password',
  THUNDERBIRD = 'thunderbird',
  BLENDER = 'blender',
  VSCODE = 'vscode',
  TERMINAL = 'terminal',
  DESKTOP = 'desktop',
  DIRECTORY = 'directory',
}
