import { Injectable, Logger } from '@nestjs/common';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { NutService } from '../nut/nut.service';
import { SCREENSHOT_CONFIG } from '../config/screenshot.config';
import { Base64ImageCompressor } from '../mcp/compressor';
import {
  ComputerAction,
  MoveMouseAction,
  TraceMouseAction,
  ClickMouseAction,
  PressMouseAction,
  DragMouseAction,
  ScrollAction,
  TypeKeysAction,
  PressKeysAction,
  TypeTextAction,
  ApplicationAction,
  Application,
  PasteTextAction,
  WriteFileAction,
  ReadFileAction,
  ImageMediaType,
} from '@bytebot/shared';

const execAsync = promisify(exec);

const DESKTOP_DISPLAY = ':0.0';
const DEFAULT_APP_WAIT_TIMEOUT_MS = 8000;
const WINDOW_POLL_INTERVAL_MS = 500;

type LaunchCommand = {
  command: string;
  args?: string[];
};

const APPLICATION_LAUNCH_COMMANDS: Partial<Record<Application, LaunchCommand>> =
  {
    firefox: { command: 'firefox-esr' },
    '1password': { command: '1password' },
    thunderbird: { command: 'thunderbird' },
    blender: { command: 'blender' },
    vscode: { command: 'code' },
    terminal: { command: 'xfce4-terminal' },
    directory: { command: 'thunar' },
  };

const APPLICATION_WINDOW_CLASSES: Record<Application, string[]> = {
  firefox: ['Navigator.firefox-esr', 'firefox-esr.Firefox'],
  '1password': ['1password.1Password'],
  thunderbird: ['Mail.thunderbird'],
  blender: ['blender.Blender', 'Blender.blender', 'blender.blender'],
  vscode: ['code.Code', 'code.code'],
  terminal: ['xfce4-terminal.Xfce4-Terminal', 'xfce4-terminal.xfce4-terminal'],
  directory: ['Thunar', 'thunar.Thunar'],
  desktop: ['xfdesktop.Xfdesktop', 'xfdesktop.xfdesktop'],
};

const APPLICATION_WAIT_TIMEOUTS: Partial<Record<Application, number>> = {
  blender: 20000,
  vscode: 12000,
};

@Injectable()
export class ComputerUseService {
  private readonly logger = new Logger(ComputerUseService.name);

  constructor(private readonly nutService: NutService) {}

  async action(params: ComputerAction): Promise<any> {
    this.logger.log(`Executing computer action: ${params.action}`);

    switch (params.action) {
      case 'move_mouse': {
        await this.moveMouse(params);
        break;
      }
      case 'trace_mouse': {
        await this.traceMouse(params);
        break;
      }
      case 'click_mouse': {
        await this.clickMouse(params);
        break;
      }
      case 'press_mouse': {
        await this.pressMouse(params);
        break;
      }
      case 'drag_mouse': {
        await this.dragMouse(params);
        break;
      }

      case 'scroll': {
        await this.scroll(params);
        break;
      }
      case 'type_keys': {
        await this.typeKeys(params);
        break;
      }
      case 'press_keys': {
        await this.pressKeys(params);
        break;
      }
      case 'type_text': {
        await this.typeText(params);
        break;
      }
      case 'paste_text': {
        await this.pasteText(params);
        break;
      }
      case 'wait': {
        const waitParams = params;
        await this.delay(waitParams.duration);
        break;
      }
      case 'screenshot':
        return this.screenshot();

      case 'cursor_position':
        return this.cursor_position();

      case 'application': {
        await this.application(params);
        break;
      }

      case 'write_file': {
        return this.writeFile(params);
      }

      case 'read_file': {
        return this.readFile(params);
      }

      default:
        throw new Error(
          `Unsupported computer action: ${(params as any).action}`,
        );
    }
  }

  private async moveMouse(action: MoveMouseAction): Promise<void> {
    await this.nutService.mouseMoveEvent(action.coordinates);
  }

  private async traceMouse(action: TraceMouseAction): Promise<void> {
    const { path, holdKeys } = action;

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(path[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Move to each coordinate in the path
    for (const coordinates of path) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async clickMouse(action: ClickMouseAction): Promise<void> {
    const { coordinates, button, holdKeys, clickCount } = action;

    // Move to coordinates if provided
    if (coordinates) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform clicks
    if (clickCount > 1) {
      // Perform multiple clicks
      for (let i = 0; i < clickCount; i++) {
        await this.nutService.mouseClickEvent(button);
        await this.delay(150);
      }
    } else {
      // Perform a single click
      await this.nutService.mouseClickEvent(button);
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async pressMouse(action: PressMouseAction): Promise<void> {
    const { coordinates, button, press } = action;

    // Move to coordinates if provided
    if (coordinates) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Perform press
    if (press === 'down') {
      await this.nutService.mouseButtonEvent(button, true);
    } else {
      await this.nutService.mouseButtonEvent(button, false);
    }
  }

  private async dragMouse(action: DragMouseAction): Promise<void> {
    const { path, button, holdKeys } = action;

    // Move to the first coordinate
    await this.nutService.mouseMoveEvent(path[0]);

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform drag
    await this.nutService.mouseButtonEvent(button, true);
    for (const coordinates of path) {
      await this.nutService.mouseMoveEvent(coordinates);
    }
    await this.nutService.mouseButtonEvent(button, false);

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async scroll(action: ScrollAction): Promise<void> {
    const { coordinates, direction, scrollCount, holdKeys } = action;

    // Move to coordinates if provided
    if (coordinates) {
      await this.nutService.mouseMoveEvent(coordinates);
    }

    // Hold keys if provided
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, true);
    }

    // Perform scroll
    for (let i = 0; i < scrollCount; i++) {
      await this.nutService.mouseWheelEvent(direction, 1);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    // Release hold keys
    if (holdKeys) {
      await this.nutService.holdKeys(holdKeys, false);
    }
  }

  private async typeKeys(action: TypeKeysAction): Promise<void> {
    const { keys, delay } = action;
    await this.nutService.sendKeys(keys, delay);
  }

  private async pressKeys(action: PressKeysAction): Promise<void> {
    const { keys, press } = action;
    await this.nutService.holdKeys(keys, press === 'down');
  }

  private async typeText(action: TypeTextAction): Promise<void> {
    const { text, delay } = action;
    await this.nutService.typeText(text, delay);
  }

  private async pasteText(action: PasteTextAction): Promise<void> {
    const { text } = action;
    await this.nutService.pasteText(text);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async screenshot(): Promise<{ image: string; mediaType: ImageMediaType }> {
    this.logger.log(`Taking screenshot`);
    const buffer = await this.nutService.screendump();
    const base64Image = buffer.toString('base64');

    if (!SCREENSHOT_CONFIG.compressionEnabled) {
      return { image: base64Image, mediaType: SCREENSHOT_CONFIG.mediaType };
    }

    try {
      const compressed = await Base64ImageCompressor.compressWithResize(
        base64Image,
        {
          targetSizeKB: SCREENSHOT_CONFIG.targetSizeKB,
          initialQuality: SCREENSHOT_CONFIG.initialQuality,
          minQuality: SCREENSHOT_CONFIG.minQuality,
          maxWidth: SCREENSHOT_CONFIG.maxWidth,
          maxHeight: SCREENSHOT_CONFIG.maxHeight,
          format: SCREENSHOT_CONFIG.format,
        },
      );

      this.logger.debug(
        `Screenshot compressed to ${compressed.sizeKB.toFixed(1)}KB`,
      );

      return {
        image: compressed.base64,
        mediaType: SCREENSHOT_CONFIG.mediaType,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown compression error';
      this.logger.warn(`Screenshot compression failed: ${message}`);
      return { image: base64Image, mediaType: SCREENSHOT_CONFIG.mediaType };
    }
  }

  private async cursor_position(): Promise<{ x: number; y: number }> {
    this.logger.log(`Getting cursor position`);
    return await this.nutService.getCursorPosition();
  }

  private getWindowMatchers(application: Application): string[] {
    return APPLICATION_WINDOW_CLASSES[application] ?? [];
  }

  private async listWindows(): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `sudo -u user env DISPLAY=${DESKTOP_DISPLAY} wmctrl -lx`,
        {
          timeout: 5000,
        },
      );
      return stdout.toLowerCase();
    } catch (error) {
      this.logger.warn(`wmctrl list failed: ${(error as Error).message}`);
      return '';
    }
  }

  private async isApplicationOpen(application: Application): Promise<boolean> {
    const matchers = this.getWindowMatchers(application).map((matcher) =>
      matcher.toLowerCase(),
    );
    if (matchers.length === 0) {
      return false;
    }

    const windows = await this.listWindows();
    return matchers.some((matcher) => windows.includes(matcher));
  }

  private async waitForApplicationWindow(
    application: Application,
  ): Promise<boolean> {
    const timeout =
      APPLICATION_WAIT_TIMEOUTS[application] ?? DEFAULT_APP_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      if (await this.isApplicationOpen(application)) {
        return true;
      }
      await this.delay(WINDOW_POLL_INTERVAL_MS);
    }

    return false;
  }

  private async application(action: ApplicationAction): Promise<void> {
    const spawnAndForget = (
      command: string,
      args: string[],
      options: Record<string, any> = {},
    ): void => {
      const child = spawn(command, args, {
        env: { ...process.env, DISPLAY: DESKTOP_DISPLAY },
        stdio: 'ignore',
        detached: true,
        ...options,
      });
      child.unref();
    };

    const focusWindow = (application: Application) => {
      const windowClass = this.getWindowMatchers(application)[0];
      if (!windowClass) {
        return;
      }

      spawnAndForget('sudo', [
        '-u',
        'user',
        'env',
        `DISPLAY=${DESKTOP_DISPLAY}`,
        'wmctrl',
        '-x',
        '-a',
        windowClass,
      ]);

      spawnAndForget('sudo', [
        '-u',
        'user',
        'env',
        `DISPLAY=${DESKTOP_DISPLAY}`,
        'wmctrl',
        '-x',
        '-r',
        windowClass,
        '-b',
        'add,maximized_vert,maximized_horz',
      ]);
    };

    if (action.application === 'desktop') {
      spawnAndForget('sudo', [
        '-u',
        'user',
        'env',
        `DISPLAY=${DESKTOP_DISPLAY}`,
        'wmctrl',
        '-k',
        'on',
      ]);
      return;
    }

    const launchConfig = APPLICATION_LAUNCH_COMMANDS[action.application];
    if (!launchConfig) {
      throw new Error(`Unsupported application: ${String(action.application)}`);
    }

    if (await this.isApplicationOpen(action.application)) {
      this.logger.log(`Application ${action.application} is already open`);
      focusWindow(action.application);
      return;
    }

    spawnAndForget('sudo', [
      '-u',
      'user',
      'env',
      `DISPLAY=${DESKTOP_DISPLAY}`,
      'nohup',
      launchConfig.command,
      ...(launchConfig.args ?? []),
    ]);

    this.logger.log(`Application ${action.application} launching`);

    const windowDetected = await this.waitForApplicationWindow(
      action.application,
    );

    if (!windowDetected) {
      throw new Error(
        `Timed out waiting for ${action.application} window to appear`,
      );
    }

    focusWindow(action.application);
    this.logger.log(`Application ${action.application} launched and focused`);
  }

  private async writeFile(
    action: WriteFileAction,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const execAsync = promisify(exec);

      // Decode base64 data
      const buffer = Buffer.from(action.data, 'base64');

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Ensure directory exists using sudo
      const dir = path.dirname(targetPath);
      try {
        await execAsync(`sudo mkdir -p "${dir}"`);
      } catch (error) {
        // Directory might already exist, which is fine
        this.logger.debug(`Directory creation: ${error.message}`);
      }

      // Write to a temporary file first
      const tempFile = `/tmp/bytebot_temp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await fs.writeFile(tempFile, buffer);

      // Move the file to the target location using sudo
      try {
        await execAsync(`sudo cp "${tempFile}" "${targetPath}"`);
        await execAsync(`sudo chown user:user "${targetPath}"`);
        await execAsync(`sudo chmod 644 "${targetPath}"`);
        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }

      this.logger.log(`File written successfully to: ${targetPath}`);
      return {
        success: true,
        message: `File written successfully to: ${targetPath}`,
      };
    } catch (error) {
      this.logger.error(`Error writing file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error writing file: ${error.message}`,
      };
    }
  }

  private async readFile(action: ReadFileAction): Promise<{
    success: boolean;
    data?: string;
    name?: string;
    size?: number;
    mediaType?: string;
    message?: string;
  }> {
    try {
      const execAsync = promisify(exec);

      // Resolve path - if relative, make it relative to user's home directory
      let targetPath = action.path;
      if (!path.isAbsolute(targetPath)) {
        targetPath = path.join('/home/user/Desktop', targetPath);
      }

      // Copy file to temp location using sudo to read it
      const tempFile = `/tmp/bytebot_read_${Date.now()}_${Math.random().toString(36).substring(7)}`;

      try {
        // Copy the file to a temporary location we can read
        await execAsync(`sudo cp "${targetPath}" "${tempFile}"`);
        await execAsync(`sudo chmod 644 "${tempFile}"`);

        // Read file as buffer from temp location
        const buffer = await fs.readFile(tempFile);

        // Get file stats for size using sudo
        const { stdout: statOutput } = await execAsync(
          `sudo stat -c "%s" "${targetPath}"`,
        );
        const fileSize = parseInt(statOutput.trim(), 10);

        // Clean up temp file
        await fs.unlink(tempFile).catch(() => {});

        // Convert to base64
        const base64Data = buffer.toString('base64');

        // Extract filename from path
        const fileName = path.basename(targetPath);

        // Determine media type based on file extension
        const ext = path.extname(targetPath).toLowerCase().slice(1);
        const mimeTypes: Record<string, string> = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          doc: 'application/msword',
          txt: 'text/plain',
          html: 'text/html',
          json: 'application/json',
          xml: 'text/xml',
          csv: 'text/csv',
          rtf: 'application/rtf',
          odt: 'application/vnd.oasis.opendocument.text',
          epub: 'application/epub+zip',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          webp: 'image/webp',
          gif: 'image/gif',
          svg: 'image/svg+xml',
        };

        const mediaType = mimeTypes[ext] || 'application/octet-stream';

        this.logger.log(`File read successfully from: ${targetPath}`);
        return {
          success: true,
          data: base64Data,
          name: fileName,
          size: fileSize,
          mediaType: mediaType,
        };
      } catch (error) {
        // Clean up temp file on error
        await fs.unlink(tempFile).catch(() => {});
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error reading file: ${error.message}`, error.stack);
      return {
        success: false,
        message: `Error reading file: ${error.message}`,
      };
    }
  }
}
